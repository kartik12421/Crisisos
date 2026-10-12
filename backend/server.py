from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional
import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid

import jwt
import requests
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field, field_validator
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import Response


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get("DB_NAME", "crisisos_db")]
DEMO_MODE = os.getenv("CRISISOS_DEMO_MODE", "true").lower() == "true"
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
LLM_PROVIDER = "openai"
LLM_MODEL = "gpt-5.6-terra"
LLM_TIMEOUT_SECONDS = 25
JWT_SECRET = os.environ.get("JWT_SECRET", "f82ca0e780aa101fc1f7ac77e30f1f01ac7ec17e9c64613cb096a3b20538d5f5")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
STORAGE_APP_NAME = "crisisos"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MEDIA_URL_TTL_SECONDS = 600
storage_key: str | None = None

app = FastAPI(title="CrisisOS API", version="1.0.0")
api_router = APIRouter(prefix="/api")
logger = logging.getLogger("crisisos")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

Role = Literal["CITIZEN", "RESPONDER", "OPERATOR", "ADMIN", "ORGANIZATION_ADMIN"]
EmergencyType = Literal[
    "GENERAL", "TRAPPED_PERSON", "MEDICAL", "FIRE", "FLOOD", "ACCIDENT",
    "BUILDING_COLLAPSE", "MISSING_PERSON", "OTHER"
]
AssignmentStatus = Literal["ASSIGNED", "ACCEPTED", "EN_ROUTE", "ON_SCENE", "COMPLETED", "CANCELLED"]
AlertSeverity = Literal["INFO", "WARNING", "CRITICAL"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)

RATE_WINDOW_SECONDS = 300
RATE_MAX_ATTEMPTS = 10
_rate_buckets: dict[str, list[float]] = {}


def check_rate_limit(key: str) -> None:
    now = time.time()
    attempts = [t for t in _rate_buckets.get(key, []) if now - t < RATE_WINDOW_SECONDS]
    if len(attempts) >= RATE_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts — try again in a few minutes")
    attempts.append(now)
    _rate_buckets[key] = attempts


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict[str, Any]:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def normalize_mobile(value: str) -> str:
    """Normalize mobile number: keep digits and leading +, strip spaces/dashes/parentheses."""
    value = value.strip()
    if value.startswith("+"):
        return "+" + "".join(ch for ch in value[1:] if ch.isdigit())
    return "".join(ch for ch in value if ch.isdigit())


class SignupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    mobile_number: str = Field(min_length=10, max_length=20)
    
    @field_validator("mobile_number", mode="before")
    @classmethod
    def _normalize_mobile(cls, v: str) -> str:
        return normalize_mobile(v)
    
    @field_validator("mobile_number")
    @classmethod
    def _validate_mobile(cls, v: str) -> str:
        if not re.match(r"^\+?\d{10,15}$", v):
            raise ValueError("Mobile number must be 10-15 digits (optionally starting with +)")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthUser(BaseModel):
    id: str
    name: str
    email: str
    role: str
    organization_id: str
    mobile_number: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUser


def make_token(user: dict[str, Any]) -> str:
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user["id"], "role": user["role"], "iat": now}, JWT_SECRET, algorithm=JWT_ALGORITHM)


def auth_user(doc: dict[str, Any]) -> AuthUser:
    return AuthUser(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        role=doc["role"],
        organization_id=doc.get("organization_id", "default"),
        mobile_number=doc.get("mobile_number"),
    )


async def resolve_user(credentials: HTTPAuthorizationCredentials | None, token_query: str | None) -> dict[str, Any]:
    raw = credentials.credentials if credentials else token_query
    unauthorized = HTTPException(status_code=401, detail="Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})
    if not raw:
        raise unauthorized
    try:
        payload = jwt.decode(raw, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise unauthorized
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user or user.get("disabled", False):
        raise unauthorized
    return user


async def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict[str, Any]:
    return await resolve_user(credentials, None)


def require_roles(*allowed: str):
    async def guard(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return guard


async def seed_users() -> None:
    seeds = [
        ("citizen@crisisos.app", "DEMO_CITIZEN_PASSWORD", "Maya Rao", "CITIZEN", "+15551234567"),
        ("responder@crisisos.app", "DEMO_RESPONDER_PASSWORD", "Alex Morgan", "RESPONDER", "+15552345678"),
        ("operator@crisisos.app", "DEMO_OPERATOR_PASSWORD", "Jordan Lee", "OPERATOR", "+15553456789"),
        ("admin@crisisos.app", "DEMO_ADMIN_PASSWORD", "Sam Rivera", "ADMIN", "+15554567890"),
    ]
    default_password = "CrisisOS2026!"
    for email, env_key, name, role, mobile in seeds:
        password = os.environ.get(env_key)
        if password:
            password = password[:72]
        existing = await db.users.find_one({"email": email})
        if existing:
            continue
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": email, "name": name, "role": role,
            "password_hash": pwd_context.hash(password or default_password),
            "organization_id": "crisisos-demo", "disabled": False, "created_at": now_iso(),
            "mobile_number": mobile,
        })


class DemoLoginRequest(BaseModel):
    role: Role


class DemoSession(BaseModel):
    user_id: str
    name: str
    role: Role
    organization_id: str
    demo_mode: bool


class SOSCreate(BaseModel):
    emergency_type: EmergencyType = "GENERAL"
    description: str = ""
    affected_people: int = Field(default=1, ge=1, le=500)
    idempotency_key: str = Field(min_length=8, max_length=120)
    location: dict[str, Any] = Field(default_factory=lambda: {
        "type": "Point", "coordinates": [], "source": "UNKNOWN", "accuracy": None, "timestamp": now_iso()
    })
    media_paths: list[str] = Field(default_factory=list, max_length=4)


class DispatchApproval(BaseModel):
    responder_id: str


class AssignmentStatusUpdate(BaseModel):
    status: AssignmentStatus
    note: str = ""


class ResponderStatusUpdate(BaseModel):
    status: Literal["AVAILABLE", "BUSY", "OFFLINE", "EN_ROUTE", "ON_SCENE"]


class ResponderLocationUpdate(BaseModel):
    location: dict[str, Any]


class OperatorAssignmentStatus(BaseModel):
    status: Literal["ASSIGNED", "EN_ROUTE", "ON_SCENE", "COMPLETED", "CANCELLED"]
    note: str = ""


class OperatorLocationUpdate(BaseModel):
    location: dict[str, Any]


class OperatorAssignmentCreate(BaseModel):
    incident_id: str


class OperatorAssignmentResponse(BaseModel):
    id: str
    operator_id: str
    operator_name: str
    incident_id: str
    citizen_id: str
    citizen_name: str
    status: str
    assigned_at: str
    updated_at: str
    note: str = ""
    incident: Optional["IncidentResponse"] = None


class NearestIncidentResponse(BaseModel):
    id: str
    sos_id: str
    title: str
    description: str
    type: EmergencyType
    status: str
    severity: str
    location: dict[str, Any]
    affected_people: int
    ai_analysis: dict[str, Any]
    media: list[dict[str, Any]] = []
    reported_by: str | None = None
    reported_by_name: str | None = None
    reported_by_mobile: str | None = None
    created_at: str
    distance_km: float


class LocateCitizenResponse(BaseModel):
    success: bool
    message: str


class AlertCreate(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    message: str = Field(min_length=3, max_length=1000)
    severity: AlertSeverity = "WARNING"
    radius_km: float | None = Field(default=None, ge=0.5, le=200)


class AlertResponse(BaseModel):
    id: str
    title: str
    message: str
    severity: str
    radius_km: float | None = None
    created_by: str
    created_at: str
    active: bool = True


class IncidentResponse(BaseModel):
    id: str
    sos_id: str
    title: str
    description: str
    type: EmergencyType
    status: str
    severity: str
    location: dict[str, Any]
    affected_people: int
    ai_analysis: dict[str, Any]
    media: list[dict[str, Any]] = []
    reported_by: str | None = None
    reported_by_mobile: str | None = None
    assigned_responder_id: str | None = None
    created_at: str
    updated_at: str


class ResponderResponse(BaseModel):
    id: str
    name: str
    team: str
    skills: list[str]
    status: str
    distance_km: float
    current_location: dict[str, Any] | None = None
    location_history: list[dict[str, Any]] = Field(default_factory=list)


class AssignmentResponse(BaseModel):
    id: str
    incident_id: str
    responder_id: str
    responder_name: str
    status: str
    approved_by: str
    assigned_at: str
    updated_at: str
    note: str = ""


class AuditResponse(BaseModel):
    id: str
    action: str
    actor: str
    target_id: str
    detail: str
    created_at: str


PRIVILEGED_EVENTS = {"responder.location"}


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[WebSocket, dict[str, str]] = {}

    async def connect(self, websocket: WebSocket, role: str, user_id: str) -> None:
        await websocket.accept()
        self.connections[websocket] = {"role": role, "user_id": user_id}

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.pop(websocket, None)

    async def broadcast(self, event: dict[str, Any], target_user_id: str | None = None) -> None:
        if not self.connections:
            return
        message = json.dumps(event)
        privileged = event.get("type") in PRIVILEGED_EVENTS
        stale: list[WebSocket] = []
        for connection, info in list(self.connections.items()):
            if privileged and info["role"] == "CITIZEN":
                continue
            if target_user_id and info["user_id"] != target_user_id:
                continue
            try:
                await connection.send_text(message)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(connection)


manager = ConnectionManager()


async def broadcast(event_type: str, payload: dict[str, Any], target_user_id: str | None = None) -> None:
    try:
        await manager.broadcast({"type": event_type, "payload": payload, "at": now_iso()}, target_user_id)
    except Exception as exc:
        logger.warning("broadcast failed: %s", exc)


@api_router.websocket("/ws")
async def events_ws(websocket: WebSocket, token: str | None = Query(default=None)) -> None:
    try:
        payload = jwt.decode(token or "", JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "id": 1, "role": 1, "disabled": 1})
        if not user or user.get("disabled", False):
            raise ValueError("unknown user")
        role = str(user.get("role", "CITIZEN"))
    except Exception:
        await websocket.close(code=4401)
        return
    await manager.connect(websocket, role, user["id"])
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "payload": {}, "at": now_iso()}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


ALLOWED_TYPES = {"GENERAL", "TRAPPED_PERSON", "MEDICAL", "FIRE", "FLOOD", "ACCIDENT", "BUILDING_COLLAPSE", "MISSING_PERSON", "OTHER"}
ALLOWED_SEVERITIES = {"LOW", "MODERATE", "HIGH", "CRITICAL"}
ALLOWED_CAPABILITIES = {"BUILDING_RESCUE", "FIRST_AID", "MEDICAL", "EVACUATION", "FIRE_SUPPRESSION", "SEARCH_RESCUE"}

TRIAGE_SYSTEM_PROMPT = (
    "You are CrisisOS, an emergency triage analyst for a crisis response platform. "
    "Analyze the SOS report and respond with ONLY a raw JSON object (no markdown, no code fences, no commentary) with exactly these keys: "
    '"type" (one of GENERAL, TRAPPED_PERSON, MEDICAL, FIRE, FLOOD, ACCIDENT, BUILDING_COLLAPSE, MISSING_PERSON, OTHER), '
    '"severity" (one of LOW, MODERATE, HIGH, CRITICAL), '
    '"required_capabilities" (array, subset of BUILDING_RESCUE, FIRST_AID, MEDICAL, EVACUATION, FIRE_SUPPRESSION, SEARCH_RESCUE), '
    '"summary" (string, max 2 factual sentences for a command center operator), '
    '"risks" (array of 1-4 short strings), '
    '"confidence" (number between 0 and 1). '
    "You only recommend. Dispatch decisions are always made by a human operator."
)


def analysis_for(sos: SOSCreate) -> dict[str, Any]:
    text = sos.description.lower()
    trapped = sos.emergency_type in {"TRAPPED_PERSON", "BUILDING_COLLAPSE"} or "fas" in text or "trapped" in text
    critical = trapped or sos.emergency_type in {"FIRE", "MEDICAL"} or sos.affected_people >= 4
    required = ["BUILDING_RESCUE", "FIRST_AID"] if trapped else ["FIRST_AID"]
    summary = "Multiple people may be trapped inside a building." if trapped else (
        f"{sos.emergency_type.replace('_', ' ').title()} report requiring coordinated assessment."
    )
    return {
        "is_emergency": True,
        "type": "TRAPPED_PERSON" if trapped else sos.emergency_type,
        "severity": "CRITICAL" if critical else "HIGH",
        "people_count": sos.affected_people,
        "required_capabilities": required,
        "summary": summary,
        "risks": ["Structural instability", "Delayed access" ] if trapped else ["Situation may escalate"],
        "confidence": 0.96 if trapped else 0.84,
        "provider": "deterministic-safety-provider",
        "human_approval_required": True,
    }


async def llm_analysis(sos: SOSCreate) -> dict[str, Any] | None:
    """LLM triage via the Emergent universal key. Returns None on any failure so
    the caller falls back to the deterministic safety provider."""
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"sos-triage-{uuid.uuid4()}",
            system_message=TRIAGE_SYSTEM_PROMPT,
        ).with_model(LLM_PROVIDER, LLM_MODEL)
        message = UserMessage(text=(
            "SOS report:\n"
            f"- Reported type: {sos.emergency_type}\n"
            f"- Affected people: {sos.affected_people}\n"
            f"- Description: {sos.description or '(none provided)'}"
        ))

        async def collect() -> str:
            chunks: list[str] = []
            async for event in chat.stream_message(message):
                if isinstance(event, TextDelta):
                    chunks.append(event.content)
                elif isinstance(event, StreamDone):
                    break
            return "".join(chunks)

        raw = await asyncio.wait_for(collect(), timeout=LLM_TIMEOUT_SECONDS)
        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`").lstrip("json").strip()
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        data = json.loads(text[start:end + 1])

        emergency_type = str(data.get("type", sos.emergency_type)).upper()
        if emergency_type not in ALLOWED_TYPES:
            emergency_type = sos.emergency_type
        severity = str(data.get("severity", "HIGH")).upper()
        if severity not in ALLOWED_SEVERITIES:
            severity = "HIGH"
        capabilities = [str(c).upper() for c in data.get("required_capabilities", []) if str(c).upper() in ALLOWED_CAPABILITIES]
        if not capabilities:
            capabilities = ["FIRST_AID"]
        try:
            confidence = min(1.0, max(0.0, float(data.get("confidence", 0.7))))
        except (TypeError, ValueError):
            confidence = 0.7
        risks = [str(risk) for risk in data.get("risks", [])][:4] or ["Situation may escalate"]
        summary = str(data.get("summary", "")).strip() or analysis_for(sos)["summary"]

        return {
            "is_emergency": True,
            "type": emergency_type,
            "severity": severity,
            "people_count": sos.affected_people,
            "required_capabilities": capabilities,
            "summary": summary,
            "risks": risks,
            "confidence": confidence,
            "provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
            "human_approval_required": True,
        }
    except Exception as exc:
        logger.warning("LLM triage failed, falling back to deterministic provider: %s", exc)
        return None


async def audit(action: str, actor: str, target_id: str, detail: str) -> None:
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": action, "actor": actor,
        "target_id": target_id, "detail": detail, "created_at": now_iso()
    })


async def ensure_indexes() -> None:
    await db.incidents.create_index("created_at")
    await db.incidents.create_index("status")
    await db.incidents.create_index([("location.coordinates", "2dsphere")])
    await db.sos.create_index("idempotency_key", unique=True)
    await db.responders.create_index("status")
    await db.assignments.create_index("status")
    await db.audit_logs.create_index("created_at")
    await db.users.create_index("email", unique=True)
    await db.alerts.create_index("active")
    await db.media.create_index("storage_path", unique=True)
    await db.operator_assignments.create_index("operator_id")
    await db.operator_assignments.create_index("status")
    await db.operator_locations.create_index("operator_id", unique=True)


async def seed_responders() -> None:
    if await db.responders.count_documents({}) > 0:
        return
    responders = [
        {"id": "responder-alpha", "name": "Alpha Rescue Team", "team": "Urban Search & Rescue", "skills": ["BUILDING_RESCUE", "FIRST_AID"], "status": "AVAILABLE", "distance_km": 1.8, "current_location": None},
        {"id": "responder-bravo", "name": "Bravo Medical Unit", "team": "Emergency Medical", "skills": ["FIRST_AID", "MEDICAL"], "status": "AVAILABLE", "distance_km": 3.4, "current_location": None},
        {"id": "responder-charlie", "name": "Charlie Response", "team": "General Response", "skills": ["EVACUATION", "FIRST_AID"], "status": "AVAILABLE", "distance_km": 5.7, "current_location": None},
    ]
    await db.responders.insert_many(responders)


async def incident_doc(doc: dict[str, Any]) -> IncidentResponse:
    return IncidentResponse(**doc)


@app.get("/health")
async def health_root() -> dict[str, str]:
    return {"status": "ok", "service": "crisisos-api"}

@app.get("/v1/models")
@app.head("/v1/models")
async def v1_models() -> dict[str, list]:
    return {"data": []}

@api_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "crisisos-api"}


@api_router.get("/ready")
async def ready() -> dict[str, str]:
    await db.command("ping")
    return {"status": "ready", "database": "connected"}


@api_router.post("/auth/signup", response_model=TokenResponse, status_code=201)
async def signup(input: SignupRequest, request: Request) -> TokenResponse:
    email = input.email.lower().strip()
    check_rate_limit(f"signup:{email}")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")
    doc = {
        "id": str(uuid.uuid4()), "email": email, "name": input.name.strip(), "role": "CITIZEN",
        "password_hash": pwd_context.hash(input.password), "organization_id": "crisisos-demo",
        "disabled": False, "created_at": now_iso(),
        "mobile_number": input.mobile_number.strip(),
    }
    await db.users.insert_one(dict(doc))
    await audit("USER_REGISTERED", email, doc["id"], "Citizen account self-registered")
    return TokenResponse(access_token=make_token(doc), user=auth_user(doc))


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(input: LoginRequest, request: Request) -> TokenResponse:
    email = input.email.lower().strip()
    check_rate_limit(f"login:{email}")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or user.get("disabled", False) or not pwd_context.verify(input.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password", headers={"WWW-Authenticate": "Bearer"})
    return TokenResponse(access_token=make_token(user), user=auth_user(user))


@api_router.get("/auth/me", response_model=AuthUser)
async def me(user: dict[str, Any] = Depends(get_current_user)) -> AuthUser:
    return auth_user(user)


@api_router.post("/auth/demo", response_model=DemoSession)
async def demo_login(input: DemoLoginRequest) -> DemoSession:
    if not DEMO_MODE:
        raise HTTPException(status_code=404, detail="Not found")
    names = {"CITIZEN": "Maya Rao", "RESPONDER": "Alex Morgan", "OPERATOR": "Jordan Lee", "ADMIN": "Sam Rivera", "ORGANIZATION_ADMIN": "Taylor Kim"}
    return DemoSession(user_id=f"demo-{input.role.lower()}", name=names[input.role], role=input.role, organization_id="demo-organization", demo_mode=DEMO_MODE)


@api_router.post("/demo/reset")
async def reset_demo(user: dict[str, Any] = Depends(require_roles("ADMIN"))) -> dict[str, str]:
    if not DEMO_MODE:
        raise HTTPException(status_code=404, detail="Not found")
    await db.sos.delete_many({})
    await db.incidents.delete_many({})
    await db.assignments.delete_many({})
    await db.audit_logs.delete_many({})
    await db.responders.delete_many({})
    await db.alerts.delete_many({})
    await db.media.delete_many({})
    await seed_responders()
    await seed_users()
    await broadcast("demo.reset", {})
    return {"status": "reset"}


def sign_media_path(path: str) -> dict[str, Any]:
    expires = int(time.time()) + MEDIA_URL_TTL_SECONDS
    signature = hmac.new(JWT_SECRET.encode(), f"{path}:{expires}".encode(), hashlib.sha256).hexdigest()[:40]
    return {"url": f"/api/files/{path}?mt={signature}&exp={expires}", "expires_at": expires}


async def assert_media_access(path: str, user: dict[str, Any]) -> dict[str, Any]:
    media = await db.media.find_one({"storage_path": path}, {"_id": 0})
    if not media:
        raise HTTPException(status_code=404, detail="File not found")
    if user.get("role") == "CITIZEN" and media.get("owner_id") != user["id"]:
        attached = await db.incidents.find_one({"media.path": path, "reported_by": user["id"]})
        if not attached:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
    return media


@api_router.get("/media/sign")
async def sign_media(path: str = Query(...), user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    await assert_media_access(path, user)
    return sign_media_path(path)


@api_router.post("/upload", status_code=201)
async def upload_file(file: UploadFile = File(...), user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    content_type = file.content_type or "application/octet-stream"
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported")
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 8 MB)")
    filename = file.filename or "photo.jpg"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp", "heic", "gif"}:
        ext = "jpg"
    path = f"{STORAGE_APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    try:
        await run_in_threadpool(put_object, path, data, content_type)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else 500
        if status == 402:
            raise HTTPException(status_code=402, detail="Storage credits exhausted — try again later")
        logger.warning("storage upload failed (%s): %s", status, exc)
        raise HTTPException(status_code=502, detail="Upload failed — please retry")
    media_id = str(uuid.uuid4())
    await db.media.insert_one({"id": media_id, "owner_id": user["id"], "storage_path": path, "content_type": content_type, "size": len(data), "created_at": now_iso()})
    return {"id": media_id, "path": path, "content_type": content_type}


@api_router.get("/files/{path:path}")
async def get_file(
    path: str,
    mt: str | None = Query(default=None),
    exp: int | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Response:
    if mt is not None and exp is not None:
        expected = hmac.new(JWT_SECRET.encode(), f"{path}:{exp}".encode(), hashlib.sha256).hexdigest()[:40]
        if exp < int(time.time()) or not hmac.compare_digest(expected, mt):
            raise HTTPException(status_code=401, detail="Invalid or expired media link")
        if not await db.media.find_one({"storage_path": path}):
            raise HTTPException(status_code=404, detail="File not found")
    else:
        user = await resolve_user(credentials, None)
        await assert_media_access(path, user)
    try:
        data, content_type = await run_in_threadpool(get_object, path)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else 500
        raise HTTPException(status_code=502 if status >= 500 else status, detail="File unavailable")
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=300"})


@api_router.post("/sos", response_model=IncidentResponse, status_code=201)
async def create_sos(input: SOSCreate, user: dict[str, Any] = Depends(get_current_user)) -> IncidentResponse:
    existing = await db.sos.find_one({"idempotency_key": input.idempotency_key}, {"_id": 0})
    if existing:
        saved = await db.incidents.find_one({"id": existing["incident_id"]}, {"_id": 0})
        if saved:
            return await incident_doc(saved)

    await seed_responders()
    created_at = now_iso()
    sos_id = str(uuid.uuid4())
    incident_id = str(uuid.uuid4())
    ai = await llm_analysis(input) or analysis_for(input)
    media_docs: list[dict[str, Any]] = []
    for path in input.media_paths[:4]:
        media = await db.media.find_one({"storage_path": path, "owner_id": user["id"]}, {"_id": 0})
        if media:
            media_docs.append({"path": path, "content_type": media["content_type"]})
    doc = {
        "id": incident_id, "sos_id": sos_id,
        "title": f"{ai['type'].replace('_', ' ').title()} emergency",
        "description": input.description or "Citizen reported an emergency.",
        "type": ai["type"], "status": "ACKNOWLEDGED", "severity": ai["severity"],
        "location": input.location, "affected_people": input.affected_people,
        "ai_analysis": ai, "media": media_docs, "reported_by": user["id"],
        "reported_by_mobile": user.get("mobile_number"),
        "assigned_responder_id": None,
        "created_at": created_at, "updated_at": created_at,
    }
    sos_doc = {"id": sos_id, "incident_id": incident_id, "idempotency_key": input.idempotency_key, "created_at": created_at}
    await db.sos.insert_one(sos_doc)
    await db.incidents.insert_one(dict(doc))
    await audit("USER_CREATED_SOS", user["email"], incident_id, "SOS acknowledged and incident created")
    await audit("AI_ANALYSIS_CREATED", ai.get("provider", "safety-provider"), incident_id, "AI recommendation stored; human approval required")
    await broadcast("incident.created", {"incident_id": incident_id, "sos_id": sos_id})
    return await incident_doc(doc)


@api_router.get("/incidents", response_model=list[IncidentResponse])
async def list_incidents(status: str | None = Query(default=None), user: dict[str, Any] = Depends(get_current_user)) -> list[IncidentResponse]:
    query: dict[str, Any] = {"status": status} if status else {}
    if user.get("role") == "CITIZEN":
        query["reported_by"] = user["id"]
    docs = await db.incidents.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [await incident_doc(doc) for doc in docs]


@api_router.get("/incidents/{incident_id}", response_model=IncidentResponse)
async def get_incident(incident_id: str, user: dict[str, Any] = Depends(get_current_user)) -> IncidentResponse:
    doc = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    if user.get("role") == "CITIZEN" and doc.get("reported_by") not in {None, user["id"]}:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return await incident_doc(doc)


@api_router.get("/responders", response_model=list[ResponderResponse])
async def list_responders(user: dict[str, Any] = Depends(require_roles("RESPONDER", "OPERATOR", "ADMIN"))) -> list[ResponderResponse]:
    await seed_responders()
    docs = await db.responders.find({}, {"_id": 0}).sort("distance_km", 1).to_list(50)
    return [ResponderResponse(**doc) for doc in docs]


@api_router.patch("/responders/{responder_id}/status", response_model=ResponderResponse)
async def update_responder_status(responder_id: str, input: ResponderStatusUpdate, user: dict[str, Any] = Depends(require_roles("RESPONDER", "OPERATOR", "ADMIN"))) -> ResponderResponse:
    await db.responders.update_one({"id": responder_id}, {"$set": {"status": input.status}})
    doc = await db.responders.find_one({"id": responder_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Responder not found")
    await broadcast("responder.status", {"responder_id": responder_id, "status": input.status})
    return ResponderResponse(**doc)


@api_router.patch("/responders/{responder_id}/location", response_model=ResponderResponse)
async def update_responder_location(responder_id: str, input: ResponderLocationUpdate, user: dict[str, Any] = Depends(require_roles("RESPONDER", "OPERATOR", "ADMIN"))) -> ResponderResponse:
    timestamp = now_iso()
    history_entry = {"location": input.location, "timestamp": input.location.get("timestamp", timestamp), "updated_at": timestamp}
    await db.responders.update_one(
        {"id": responder_id},
        {
            "$set": {"current_location": input.location, "last_location_update": timestamp},
            "$push": {"location_history": history_entry}
        }
    )
    doc = await db.responders.find_one({"id": responder_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Responder not found")
    await audit("RESPONDER_LOCATION_UPDATED", responder_id, responder_id, f"Location updated: {input.location.get('coordinates')}")
    await broadcast("responder.location", {"responder_id": responder_id, "location": input.location})
    return ResponderResponse(**doc)


@api_router.get("/responders/{responder_id}/location-history")
async def get_responder_location_history(responder_id: str, user: dict[str, Any] = Depends(require_roles("RESPONDER", "OPERATOR", "ADMIN"))) -> dict[str, Any]:
    doc = await db.responders.find_one({"id": responder_id}, {"_id": 0, "id": 1, "name": 1, "current_location": 1, "location_history": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Responder not found")
    return {
        "responder_id": responder_id,
        "name": doc.get("name"),
        "current_location": doc.get("current_location"),
        "total_past_locations": len(doc.get("location_history", [])),
        "location_history": doc.get("location_history", [])
    }


@api_router.post("/incidents/{incident_id}/approve-dispatch", response_model=AssignmentResponse, status_code=201)
async def approve_dispatch(incident_id: str, input: DispatchApproval, user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN"))) -> AssignmentResponse:
    incident = await db.incidents.find_one({"id": incident_id}, {"_id": 0})
    responder = await db.responders.find_one({"id": input.responder_id}, {"_id": 0})
    if not incident or not responder:
        raise HTTPException(status_code=404, detail="Incident or responder not found")
    if incident["status"] in {"RESOLVED", "CANCELLED"}:
        raise HTTPException(status_code=409, detail="Incident is no longer dispatchable")
    existing = await db.assignments.find_one({"incident_id": incident_id, "status": {"$nin": ["CANCELLED", "COMPLETED"]}}, {"_id": 0})
    if existing:
        return AssignmentResponse(**existing)
    timestamp = now_iso()
    assignment = {
        "id": str(uuid.uuid4()), "incident_id": incident_id, "responder_id": input.responder_id,
        "responder_name": responder["name"], "status": "ASSIGNED", "approved_by": user["email"],
        "assigned_at": timestamp, "updated_at": timestamp, "note": "Human operator approved dispatch.",
    }
    await db.assignments.insert_one(dict(assignment))
    await db.incidents.update_one({"id": incident_id}, {"$set": {"status": "ACTIVE_RESPONSE", "assigned_responder_id": input.responder_id, "updated_at": timestamp}})
    await db.responders.update_one({"id": input.responder_id}, {"$set": {"status": "BUSY"}})
    await audit("DISPATCH_APPROVED", user["email"], incident_id, f"Assigned {responder['name']}")
    await audit("RESOURCE_ASSIGNED", user["email"], incident_id, "Responder assignment created")
    await broadcast("assignment.updated", {"incident_id": incident_id, "assignment_id": assignment["id"], "status": "ASSIGNED"})
    return AssignmentResponse(**assignment)


@api_router.get("/assignments", response_model=list[AssignmentResponse])
async def list_assignments(user: dict[str, Any] = Depends(require_roles("RESPONDER", "OPERATOR", "ADMIN"))) -> list[AssignmentResponse]:
    docs = await db.assignments.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    return [AssignmentResponse(**doc) for doc in docs]


@api_router.patch("/assignments/{assignment_id}/status", response_model=AssignmentResponse)
async def update_assignment(assignment_id: str, input: AssignmentStatusUpdate, user: dict[str, Any] = Depends(require_roles("RESPONDER", "OPERATOR", "ADMIN"))) -> AssignmentResponse:
    assignment = await db.assignments.find_one({"id": assignment_id}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    allowed = {
        "ASSIGNED": {"ACCEPTED", "CANCELLED"}, "ACCEPTED": {"EN_ROUTE", "CANCELLED"},
        "EN_ROUTE": {"ON_SCENE", "CANCELLED"}, "ON_SCENE": {"COMPLETED"}, "COMPLETED": set(), "CANCELLED": set(),
    }
    if input.status not in allowed.get(assignment["status"], set()):
        raise HTTPException(status_code=409, detail=f"Cannot move from {assignment['status']} to {input.status}")
    timestamp = now_iso()
    await db.assignments.update_one({"id": assignment_id}, {"$set": {"status": input.status, "updated_at": timestamp, "note": input.note}})
    incident_status = {"ACCEPTED": "ACTIVE_RESPONSE", "EN_ROUTE": "ACTIVE_RESPONSE", "ON_SCENE": "ACTIVE_RESPONSE", "COMPLETED": "RESOLVED", "CANCELLED": "CANCELLED"}[input.status]
    await db.incidents.update_one({"id": assignment["incident_id"]}, {"$set": {"status": incident_status, "updated_at": timestamp}})
    responder_status = {"ACCEPTED": "BUSY", "EN_ROUTE": "EN_ROUTE", "ON_SCENE": "ON_SCENE", "COMPLETED": "AVAILABLE", "CANCELLED": "AVAILABLE"}[input.status]
    await db.responders.update_one({"id": assignment["responder_id"]}, {"$set": {"status": responder_status}})
    action = {"ACCEPTED": "RESPONDER_ACCEPTED", "EN_ROUTE": "RESPONDER_EN_ROUTE", "ON_SCENE": "RESPONDER_REACHED_SCENE", "COMPLETED": "INCIDENT_RESOLVED", "CANCELLED": "DISPATCH_REJECTED"}[input.status]
    await audit(action, user["email"], assignment["incident_id"], input.note or f"Assignment moved to {input.status}")
    await broadcast("assignment.updated", {"incident_id": assignment["incident_id"], "assignment_id": assignment_id, "status": input.status})
    updated = await db.assignments.find_one({"id": assignment_id}, {"_id": 0})
    return AssignmentResponse(**updated)


@api_router.post("/alerts", response_model=AlertResponse, status_code=201)
async def publish_alert(input: AlertCreate, user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN"))) -> AlertResponse:
    doc = {
        "id": str(uuid.uuid4()), "title": input.title.strip(), "message": input.message.strip(),
        "severity": input.severity, "radius_km": input.radius_km,
        "created_by": user["email"], "created_at": now_iso(), "active": True,
    }
    await db.alerts.insert_one(dict(doc))
    await audit("ALERT_PUBLISHED", user["email"], doc["id"], f"Alert: {doc['title']}")
    await broadcast("alert.published", {
        "alert_id": doc["id"],
        "title": doc["title"],
        "message": doc["message"],
        "severity": doc["severity"],
        "radius_km": doc["radius_km"],
        "created_by": doc["created_by"],
    })
    return AlertResponse(**doc)


@api_router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts(active_only: bool = Query(default=True), user: dict[str, Any] = Depends(get_current_user)) -> list[AlertResponse]:
    query = {"active": True} if active_only else {}
    docs = await db.alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [AlertResponse(**doc) for doc in docs]


@api_router.post("/alerts/{alert_id}/deactivate", response_model=AlertResponse)
async def deactivate_alert(alert_id: str, user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN"))) -> AlertResponse:
    await db.alerts.update_one({"id": alert_id}, {"$set": {"active": False}})
    doc = await db.alerts.find_one({"id": alert_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Alert not found")
    await audit("ALERT_DEACTIVATED", user["email"], alert_id, "Alert deactivated")
    await broadcast("alert.deactivated", {"alert_id": alert_id})
    return AlertResponse(**doc)


@api_router.get("/audit", response_model=list[AuditResponse])
async def list_audit(user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN"))) -> list[AuditResponse]:
    docs = await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [AuditResponse(**doc) for doc in docs]


@api_router.get("/analytics")
async def analytics(user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN"))) -> dict[str, Any]:
    total = await db.incidents.count_documents({})
    active = await db.incidents.count_documents({"status": {"$nin": ["RESOLVED", "CLOSED", "CANCELLED"]}})
    critical = await db.incidents.count_documents({"severity": "CRITICAL", "status": {"$nin": ["RESOLVED", "CLOSED", "CANCELLED"]}})
    approvals = await db.audit_logs.count_documents({"action": "DISPATCH_APPROVED"})

    by_type: dict[str, int] = {}
    async for row in db.incidents.aggregate([{"$group": {"_id": "$type", "count": {"$sum": 1}}}]):
        by_type[row["_id"]] = row["count"]
    by_severity: dict[str, int] = {}
    async for row in db.incidents.aggregate([{"$group": {"_id": "$severity", "count": {"$sum": 1}}}]):
        by_severity[row["_id"]] = row["count"]

    resolved_docs = await db.incidents.find({"status": "RESOLVED"}, {"_id": 0, "created_at": 1, "updated_at": 1}).to_list(200)
    durations: list[float] = []
    for doc in resolved_docs:
        try:
            durations.append((datetime.fromisoformat(doc["updated_at"]) - datetime.fromisoformat(doc["created_at"])).total_seconds() / 60)
        except (KeyError, ValueError):
            continue
    avg_resolution = round(sum(durations) / len(durations), 1) if durations else None

    return {
        "total_emergencies": total,
        "active_incidents": active,
        "critical_incidents": critical,
        "human_approvals": approvals,
        "by_type": by_type,
        "by_severity": by_severity,
        "avg_resolution_minutes": avg_resolution,
        "active_alerts": await db.alerts.count_documents({"active": True}),
        "responders_available": await db.responders.count_documents({"status": "AVAILABLE"}),
    }


@api_router.get("/operator/incidents/nearest", response_model=list[NearestIncidentResponse])
async def get_nearest_incidents(
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    max_distance_km: float = Query(default=50, ge=1, le=200),
    limit: int = Query(default=5, ge=1, le=10),
    user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN")),
) -> list[NearestIncidentResponse]:
    """Get nearest unassigned SOS incidents to operator's location."""
    await db.operator_locations.update_one(
        {"operator_id": user["id"]},
        {"$set": {"operator_id": user["id"], "coordinates": [lon, lat], "updated_at": now_iso()}},
        upsert=True,
    )

    pipeline = [
        {
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [lon, lat]},
                "distanceField": "distance_meters",
                "maxDistance": max_distance_km * 1000,
                "spherical": True,
                "query": {
                    "status": {"$nin": ["RESOLVED", "CLOSED", "CANCELLED"]},
                    "assigned_responder_id": None,
                },
            }
        },
        {"$limit": limit},
        {
            "$lookup": {
                "from": "operator_assignments",
                "localField": "id",
                "foreignField": "incident_id",
                "as": "op_assignment",
            }
        },
        {"$match": {"op_assignment": {"$size": 0}}},
        {
            "$lookup": {
                "from": "users",
                "localField": "reported_by",
                "foreignField": "id",
                "as": "citizen",
            }
        },
        {"$unwind": {"path": "$citizen", "preserveNullAndEmptyArrays": True}},
        {
            "$project": {
                "_id": 0,
                "id": 1,
                "sos_id": 1,
                "title": 1,
                "description": 1,
                "type": 1,
                "status": 1,
                "severity": 1,
                "location": 1,
                "affected_people": 1,
                "ai_analysis": 1,
                "media": 1,
                "reported_by": 1,
                "reported_by_name": "$citizen.name",
                "reported_by_mobile": "$citizen.mobile_number",
                "created_at": 1,
                "distance_km": {"$divide": ["$distance_meters", 1000]},
            }
        },
    ]

    docs = await db.incidents.aggregate(pipeline).to_list(limit)
    return [NearestIncidentResponse(**doc) for doc in docs]


@api_router.post("/operator/assignments", response_model=OperatorAssignmentResponse, status_code=201)
async def create_operator_assignment(
    input: OperatorAssignmentCreate,
    user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN")),
) -> OperatorAssignmentResponse:
    """Operator claims an incident (max 1 active assignment per operator)."""
    active = await db.operator_assignments.find_one(
        {"operator_id": user["id"], "status": {"$nin": ["COMPLETED", "CANCELLED"]}},
        {"_id": 0},
    )
    if active:
        raise HTTPException(status_code=409, detail="You already have an active assignment. Complete or cancel it first.")

    incident = await db.incidents.find_one(
        {"id": input.incident_id, "status": {"$nin": ["RESOLVED", "CLOSED", "CANCELLED"]}, "assigned_responder_id": None},
        {"_id": 0},
    )
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found or already assigned/resolved")

    existing = await db.operator_assignments.find_one(
        {"incident_id": input.incident_id, "status": {"$nin": ["COMPLETED", "CANCELLED"]}},
        {"_id": 0},
    )
    if existing:
        raise HTTPException(status_code=409, detail="Incident already claimed by another operator")

    citizen = await db.users.find_one({"id": incident["reported_by"]}, {"_id": 0, "name": 1})
    citizen_name = citizen["name"] if citizen else "Unknown"

    timestamp = now_iso()
    assignment_doc = {
        "id": str(uuid.uuid4()),
        "operator_id": user["id"],
        "operator_name": user["name"],
        "incident_id": input.incident_id,
        "citizen_id": incident["reported_by"],
        "citizen_name": citizen_name,
        "status": "ASSIGNED",
        "assigned_at": timestamp,
        "updated_at": timestamp,
        "note": "Operator accepted citizen SOS",
    }
    await db.operator_assignments.insert_one(assignment_doc)

    await db.incidents.update_one(
        {"id": input.incident_id},
        {"$set": {"status": "OPERATOR_ASSIGNED", "updated_at": timestamp}},
    )

    await audit("OPERATOR_ASSIGNED_CITIZEN", user["email"], input.incident_id, f"Assigned to citizen {citizen_name}")

    await broadcast("operator.assigned", {"assignment_id": assignment_doc["id"], "incident_id": input.incident_id, "operator_id": user["id"]})
    await broadcast("operator.assigned", {"assignment_id": assignment_doc["id"], "incident_id": input.incident_id, "operator_id": user["id"]}, target_user_id=assignment_doc["citizen_id"])

    return OperatorAssignmentResponse(**assignment_doc, incident=IncidentResponse(**incident))


@api_router.get("/operator/assignments/active", response_model=OperatorAssignmentResponse | None)
async def get_active_operator_assignment(
    user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN")),
) -> OperatorAssignmentResponse | None:
    """Get operator's current active assignment."""
    assignment = await db.operator_assignments.find_one(
        {"operator_id": user["id"], "status": {"$nin": ["COMPLETED", "CANCELLED"]}},
        {"_id": 0},
    )
    if not assignment:
        return None

    incident = await db.incidents.find_one({"id": assignment["incident_id"]}, {"_id": 0})
    return OperatorAssignmentResponse(**assignment, incident=IncidentResponse(**incident) if incident else None)


@api_router.patch("/operator/location", response_model=dict[str, str])
async def update_operator_location(
    input: OperatorLocationUpdate,
    user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN")),
) -> dict[str, str]:
    """Update operator's GPS location for nearest-incident queries."""
    timestamp = now_iso()
    history_entry = {"location": input.location, "timestamp": input.location.get("timestamp", timestamp), "updated_at": timestamp}
    await db.operator_locations.update_one(
        {"operator_id": user["id"]},
        {
            "$set": {"operator_id": user["id"], "location": input.location, "updated_at": timestamp},
            "$push": {"location_history": history_entry}
        },
        upsert=True,
    )
    await audit("OPERATOR_LOCATION_UPDATED", user["id"], user["id"], f"Operator location update: {input.location.get('coordinates')}")
    active = await db.operator_assignments.find_one(
        {"operator_id": user["id"], "status": {"$nin": ["COMPLETED", "CANCELLED"]}},
        {"_id": 0, "incident_id": 1, "citizen_id": 1},
    )
    if active:
        await broadcast("operator.location", {"operator_id": user["id"], "location": input.location, "incident_id": active["incident_id"]})
    return {"status": "updated"}


@api_router.get("/operator/location-history")
async def get_operator_location_history(user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN"))) -> dict[str, Any]:
    doc = await db.operator_locations.find_one({"operator_id": user["id"]}, {"_id": 0})
    if not doc:
        return {"operator_id": user["id"], "total_past_locations": 0, "location_history": []}
    history = doc.get("location_history", [])
    return {
        "operator_id": user["id"],
        "current_location": doc.get("location"),
        "total_past_locations": len(history),
        "location_history": history[-200:]
    }


@api_router.patch("/operator/assignments/{assignment_id}/status", response_model=OperatorAssignmentResponse)
async def update_operator_assignment_status(
    assignment_id: str,
    input: OperatorAssignmentStatus,
    user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN")),
) -> OperatorAssignmentResponse:
    """Update operator assignment status (EN_ROUTE, ON_SCENE, COMPLETED, CANCELLED)."""
    assignment = await db.operator_assignments.find_one({"id": assignment_id, "operator_id": user["id"]}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    allowed = {
        "ASSIGNED": {"EN_ROUTE", "CANCELLED"},
        "EN_ROUTE": {"ON_SCENE", "CANCELLED"},
        "ON_SCENE": {"COMPLETED", "CANCELLED"},
        "COMPLETED": set(),
        "CANCELLED": set(),
    }
    if input.status not in allowed.get(assignment["status"], set()):
        raise HTTPException(status_code=409, detail=f"Cannot move from {assignment['status']} to {input.status}")

    timestamp = now_iso()
    await db.operator_assignments.update_one(
        {"id": assignment_id},
        {"$set": {"status": input.status, "updated_at": timestamp, "note": input.note or f"Status changed to {input.status}"}},
    )

    incident_status_map = {
        "EN_ROUTE": "OPERATOR_EN_ROUTE",
        "ON_SCENE": "OPERATOR_ON_SCENE",
        "COMPLETED": "RESOLVED",
        "CANCELLED": "CANCELLED",
    }
    await db.incidents.update_one(
        {"id": assignment["incident_id"]},
        {"$set": {"status": incident_status_map.get(input.status, "OPERATOR_ASSIGNED"), "updated_at": timestamp}},
    )

    await audit(f"OPERATOR_ASSIGNMENT_{input.status}", user["email"], assignment["incident_id"], input.note or f"Operator assignment {input.status}")

    await broadcast("operator.assignment.updated", {"assignment_id": assignment_id, "incident_id": assignment["incident_id"], "status": input.status})
    await broadcast("operator.assignment.updated", {"assignment_id": assignment_id, "incident_id": assignment["incident_id"], "status": input.status}, target_user_id=assignment["citizen_id"])

    updated = await db.operator_assignments.find_one({"id": assignment_id}, {"_id": 0})
    incident = await db.incidents.find_one({"id": assignment["incident_id"]}, {"_id": 0})
    return OperatorAssignmentResponse(**updated, incident=IncidentResponse(**incident) if incident else None)


@api_router.post("/operator/assignments/{assignment_id}/locate-citizen", response_model=LocateCitizenResponse)
async def locate_citizen(
    assignment_id: str,
    user: dict[str, Any] = Depends(require_roles("OPERATOR", "ADMIN")),
) -> LocateCitizenResponse:
    """Trigger loud sound on citizen's phone to help locate them."""
    assignment = await db.operator_assignments.find_one({"id": assignment_id, "operator_id": user["id"]}, {"_id": 0})
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if assignment["status"] not in {"ASSIGNED", "EN_ROUTE", "ON_SCENE"}:
        raise HTTPException(status_code=409, detail="Assignment not in active state")

    await broadcast("operator.locate_citizen", {
        "assignment_id": assignment_id,
        "incident_id": assignment["incident_id"],
        "citizen_id": assignment["citizen_id"],
        "operator_id": user["id"],
        "operator_name": user["name"],
    }, target_user_id=assignment["citizen_id"])

    await audit("OPERATOR_LOCATE_CITIZEN", user["email"], assignment["incident_id"], "Triggered locate sound on citizen device")

    return LocateCitizenResponse(success=True, message="Locate signal sent to citizen's device")


app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup() -> None:
    await ensure_indexes()
    await seed_responders()
    await seed_users()
    try:
        await run_in_threadpool(init_storage)
        logger.info("object storage initialized")
    except Exception as exc:
        logger.warning("object storage init failed (uploads will retry on demand): %s", exc)


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    client.close()
