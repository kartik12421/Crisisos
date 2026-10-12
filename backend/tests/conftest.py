"""Shared fixtures for CrisisOS backend tests (iteration 5: security hardening).

All routes except /health /ready /auth/* require a Bearer token.
demo/reset is ADMIN-only (SEC-002); /api/ws requires ?token=JWT (SEC-003).
Role passwords come from backend env (DEMO_<ROLE>_PASSWORD); never hard-code
credentials in the test suite.
"""
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


def _load_base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        candidates = [
            Path("/app/frontend/.env"),
            Path(__file__).resolve().parents[2] / "frontend" / ".env",
            Path(__file__).resolve().parents[1] / "frontend" / ".env",
            Path.cwd() / "frontend" / ".env",
            Path.cwd().parent / "frontend" / ".env",
        ]
        for env_file in candidates:
            if not env_file.exists():
                continue
            for line in env_file.read_text().splitlines():
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    url = line.split("=", 1)[1].strip().strip('"')
                    break
            if url:
                break
    if not url:
        pytest.fail("EXPO_PUBLIC_BACKEND_URL is not set")
    return url.rstrip("/")


BASE_URL = _load_base_url()
API = f"{BASE_URL}/api"
WS_URL = f"{BASE_URL.replace('http', 'ws', 1)}/api/ws"

# Demo account passwords must be configured in backend/.env or the environment.
CREDENTIALS = {
    "CITIZEN": ("citizen@crisisos.app", os.getenv("DEMO_CITIZEN_PASSWORD", "")),
    "RESPONDER": ("responder@crisisos.app", os.getenv("DEMO_RESPONDER_PASSWORD", "")),
    "OPERATOR": ("operator@crisisos.app", os.getenv("DEMO_OPERATOR_PASSWORD", "")),
    "ADMIN": ("admin@crisisos.app", os.getenv("DEMO_ADMIN_PASSWORD", "")),
}

# Pre-iteration-5 hard-coded passwords — must now be REJECTED (SEC-001).
OLD_PASSWORDS = {
    "CITIZEN": "Citizen!2026",
    "RESPONDER": "Responder!2026",
    "OPERATOR": "Operator!2026",
    "ADMIN": "Admin!2026",
}


def ws_url(token: str) -> str:
    """Authenticated WS URL (SEC-003: JWT via ?token= query param)."""
    return f"{WS_URL}?token={token}"


@pytest.fixture(scope="session")
def api_client():
    """Unauthenticated JSON session — add Authorization headers per call."""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="session")
def admin_token(api_client):
    """Admin JWT — needed for the now admin-only demo/reset (SEC-002)."""
    email, password = CREDENTIALS["ADMIN"]
    resp = api_client.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, f"admin login failed: {resp.text}"
    return resp.json()["access_token"]


@pytest.fixture(scope="session", autouse=True)
def reset_demo(api_client, admin_token):
    """Reset demo data once before the suite for a clean state (admin-only)."""
    resp = api_client.post(f"{API}/demo/reset", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "reset"
    yield


@pytest.fixture(scope="session")
def tokens(api_client, reset_demo):
    """JWT access tokens for all four seeded roles."""
    out = {}
    for role, (email, password) in CREDENTIALS.items():
        resp = api_client.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert resp.status_code == 200, f"login failed for {role}: {resp.text}"
        out[role] = resp.json()["access_token"]
    return out


@pytest.fixture(scope="session")
def auth(tokens):
    """auth('OPERATOR') -> Authorization header dict for that role."""
    def _for(role: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {tokens[role]}"}
    return _for
