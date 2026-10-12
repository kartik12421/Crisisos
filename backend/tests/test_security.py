"""CrisisOS iteration-5 security remediation tests.

Covers the four audit findings fixed this iteration:
- SEC-001: legacy hard-coded demo passwords are rejected (401); env-sourced
  passwords work.
- SEC-002: POST /api/demo/reset — 401 unauthenticated, 403 for
  citizen/responder/operator, 200 for admin.
- SEC-003: WS /api/ws — anonymous connection refused (4401), authenticated
  ping/pong works, citizen sockets never receive responder.location but do
  receive incident.created, operator sockets receive both.
- SEC-004: raw JWT in ?token= no longer accepted on /api/files; signed media
  URLs (/api/media/sign) work without auth headers, tampered/expired
  signatures are rejected, cross-user media access denied.
- Hardening: login rate limit — 10 attempts/5min per email, 11th -> 429.

NOTE: this file must run LAST (alphabetical order guarantees it) because the
admin demo/reset wipes suite data and the rate-limit test burns attempts.
"""
import asyncio
import json
import time
import uuid

import pytest
import websockets

from conftest import API, CREDENTIALS, OLD_PASSWORDS, WS_URL, ws_url

# 1x1 transparent PNG
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000d49444154789c626001000000ffff030000060005"
    "57bfabd40000000049454e44ae426082"
)


class TestSec001PasswordRotation:
    """SEC-001: old hard-coded bundle passwords must be dead."""

    def test_old_passwords_rejected_401(self, api_client):
        for role, old_pw in OLD_PASSWORDS.items():
            email = CREDENTIALS[role][0]
            resp = api_client.post(f"{API}/auth/login", json={"email": email, "password": old_pw})
            assert resp.status_code == 401, f"SEC-001 FAIL: old {role} password still works ({resp.status_code})"

    def test_new_env_passwords_accepted(self, api_client):
        for role, (email, password) in CREDENTIALS.items():
            resp = api_client.post(f"{API}/auth/login", json={"email": email, "password": password})
            assert resp.status_code == 200, f"new {role} password rejected: {resp.text}"
            assert resp.json()["user"]["role"] == role


class TestSec002DemoResetGuard:
    """SEC-002: demo/reset is ADMIN-only."""

    def test_reset_unauthenticated_401(self, api_client):
        assert api_client.post(f"{API}/demo/reset").status_code == 401

    @pytest.mark.parametrize("role", ["CITIZEN", "RESPONDER", "OPERATOR"])
    def test_reset_non_admin_403(self, api_client, auth, role):
        resp = api_client.post(f"{API}/demo/reset", headers=auth(role))
        assert resp.status_code == 403, f"{role} got {resp.status_code}"

    def test_reset_admin_200(self, api_client, auth):
        resp = api_client.post(f"{API}/demo/reset", headers=auth("ADMIN"))
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "reset"
        # data actually wiped
        incidents = api_client.get(f"{API}/incidents", headers=auth("OPERATOR")).json()
        assert incidents == []


class TestSec003WebSocketAuth:
    """SEC-003: WS auth + role-scoped fan-out of responder GPS."""

    def test_anonymous_ws_refused(self):
        async def probe():
            try:
                async with websockets.connect(WS_URL, open_timeout=10):
                    return "CONNECTED"  # must not happen
            except websockets.exceptions.InvalidStatus as exc:
                # server rejects the upgrade handshake (uvicorn -> HTTP 403)
                return exc.response.status_code
            except websockets.exceptions.ConnectionClosed as exc:
                return exc.code
        result = asyncio.run(probe())
        assert result in (403, 4401), f"anonymous WS was accepted or oddly closed: {result}"

    def test_bad_token_ws_refused(self):
        async def probe():
            try:
                async with websockets.connect(f"{WS_URL}?token=junk", open_timeout=10):
                    return "CONNECTED"
            except websockets.exceptions.InvalidStatus as exc:
                return exc.response.status_code
            except websockets.exceptions.ConnectionClosed as exc:
                return exc.code
        result = asyncio.run(probe())
        assert result in (403, 4401), f"bad-token WS result: {result}"

    def test_authenticated_ws_ping_pong(self, tokens):
        async def probe():
            async with websockets.connect(ws_url(tokens["CITIZEN"]), open_timeout=10) as ws:
                await ws.send("ping")
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                return json.loads(raw)
        event = asyncio.run(probe())
        assert event["type"] == "pong"

    def test_citizen_ws_no_responder_gps_but_gets_incidents(self, api_client, tokens, auth):
        """Citizen socket: receives incident.created, NOT responder.location.
        Operator socket: receives both."""
        async def scenario():
            citizen_events, operator_events = [], []
            async with websockets.connect(ws_url(tokens["CITIZEN"]), open_timeout=10) as cws, \
                       websockets.connect(ws_url(tokens["OPERATOR"]), open_timeout=10) as ows:
                loop = asyncio.get_running_loop()

                def trigger():
                    r1 = api_client.post(f"{API}/sos", json={
                        "emergency_type": "FIRE", "description": "TEST sec003 ws scoping",
                        "affected_people": 1, "idempotency_key": f"TEST-sec003-{uuid.uuid4()}",
                    }, headers=auth("CITIZEN"), timeout=40)
                    assert r1.status_code == 201, r1.text
                    r2 = api_client.patch(f"{API}/responders/responder-alpha/location", json={"location": {
                        "type": "Point", "coordinates": [77.62, 12.98], "source": "CURRENT_GPS",
                        "accuracy": 10, "timestamp": "2026-01-05T00:00:00Z"}},
                        headers=auth("RESPONDER"), timeout=20)
                    assert r2.status_code == 200, r2.text

                fut = loop.run_in_executor(None, trigger)
                deadline = loop.time() + 25
                open_sockets = [cws, ows]
                while loop.time() < deadline:
                    for ws in list(open_sockets):
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                            event = json.loads(raw)
                            (citizen_events if ws is cws else operator_events).append(event)
                        except asyncio.TimeoutError:
                            pass
                    types_c = {e.get("type") for e in citizen_events}
                    types_o = {e.get("type") for e in operator_events}
                    if "incident.created" in types_c and "responder.location" in types_o:
                        # give citizen socket 2 extra seconds to wrongly receive GPS
                        grace_end = loop.time() + 2
                        while loop.time() < grace_end:
                            try:
                                raw = await asyncio.wait_for(cws.recv(), timeout=0.5)
                                citizen_events.append(json.loads(raw))
                            except asyncio.TimeoutError:
                                pass
                        break
                await fut
            return citizen_events, operator_events

        citizen_events, operator_events = asyncio.run(scenario())
        c_types = [e.get("type") for e in citizen_events]
        o_types = [e.get("type") for e in operator_events]
        assert "incident.created" in c_types, f"citizen missed incident.created; got {c_types}"
        assert "responder.location" not in c_types, \
            f"SEC-003 FAIL: citizen socket received responder.location; got {c_types}"
        assert "responder.location" in o_types, f"operator missed responder.location; got {o_types}"
        assert "incident.created" in o_types, f"operator missed incident.created; got {o_types}"


class TestSec004SignedMediaUrls:
    """SEC-004: signed URLs replace raw-JWT file access."""

    @pytest.fixture(scope="class")
    def media_path(self, api_client, auth):
        resp = api_client.post(
            f"{API}/upload",
            files={"file": ("TEST-sec4.png", PNG_BYTES, "image/png")},
            headers={"Content-Type": None, **auth("CITIZEN")},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()["path"]

    def test_raw_jwt_query_token_rejected(self, api_client, tokens, media_path):
        resp = api_client.get(f"{API}/files/{media_path}?token={tokens['CITIZEN']}")
        assert resp.status_code == 401, f"SEC-004 FAIL: raw ?token= JWT accepted ({resp.status_code})"

    def test_sign_and_fetch_without_auth_header(self, api_client, auth, media_path):
        sign = api_client.get(f"{API}/media/sign?path={media_path}", headers=auth("CITIZEN"))
        assert sign.status_code == 200, sign.text
        url_path = sign.json()["url"]
        assert "mt=" in url_path and "exp=" in url_path
        # signed URL works WITHOUT any auth header
        from conftest import BASE_URL
        resp = api_client.get(f"{BASE_URL}{url_path}")
        assert resp.status_code == 200, resp.text
        assert resp.content == PNG_BYTES

    def test_tampered_signature_401(self, api_client, auth, media_path):
        from conftest import BASE_URL
        sign = api_client.get(f"{API}/media/sign?path={media_path}", headers=auth("CITIZEN"))
        url_path = sign.json()["url"]
        tampered = url_path.replace("mt=", "mt=" + ("0" if "mt=0" not in url_path[:40] else "f"), 1)
        # flip a character inside the signature itself
        mt_start = url_path.index("mt=") + 3
        sig = url_path[mt_start:mt_start + 40]
        bad_sig = ("0" if sig[0] != "0" else "1") + sig[1:]
        tampered = url_path.replace(sig, bad_sig, 1)
        resp = api_client.get(f"{BASE_URL}{tampered}")
        assert resp.status_code == 401, f"tampered signature accepted ({resp.status_code})"

    def test_expired_signature_401(self, api_client, media_path):
        import hashlib
        import hmac as hmac_mod
        from pathlib import Path
        secret = None
        for line in Path("/app/backend/.env").read_text().splitlines():
            if line.startswith("JWT_SECRET="):
                secret = line.split("=", 1)[1].strip().strip('"')
        assert secret, "JWT_SECRET not readable for test signing"
        expired = int(time.time()) - 10
        sig = hmac_mod.new(secret.encode(), f"{media_path}:{expired}".encode(), hashlib.sha256).hexdigest()[:40]
        from conftest import BASE_URL
        resp = api_client.get(f"{BASE_URL}/api/files/{media_path}?mt={sig}&exp={expired}")
        assert resp.status_code == 401, f"expired signature accepted ({resp.status_code})"

    def test_citizen_cannot_sign_foreign_media(self, api_client, auth, media_path):
        # operator uploads; citizen tries to sign it
        up = api_client.post(
            f"{API}/upload",
            files={"file": ("TEST-sec4-ops.png", PNG_BYTES, "image/png")},
            headers={"Content-Type": None, **auth("OPERATOR")},
        )
        assert up.status_code == 201, up.text
        foreign = up.json()["path"]
        resp = api_client.get(f"{API}/media/sign?path={foreign}", headers=auth("CITIZEN"))
        assert resp.status_code == 403, f"citizen signed foreign media ({resp.status_code})"

    def test_sign_unknown_path_404(self, api_client, auth):
        resp = api_client.get(f"{API}/media/sign?path=crisisos/uploads/nobody/missing.png", headers=auth("CITIZEN"))
        assert resp.status_code == 404

    def test_sign_unauthenticated_401(self, api_client, media_path):
        assert api_client.get(f"{API}/media/sign?path={media_path}").status_code == 401

    def test_authorization_header_still_works(self, api_client, auth, media_path):
        resp = api_client.get(f"{API}/files/{media_path}", headers=auth("CITIZEN"))
        assert resp.status_code == 200
        assert resp.content == PNG_BYTES


class TestRateLimiting:
    """Login rate limit: 10 attempts per email per 5 min -> 11th is 429."""

    def test_login_rate_limit_429(self, api_client):
        email = f"TEST-ratelimit-{uuid.uuid4().hex[:8]}@crisisos.app"  # unique: fresh bucket
        codes = []
        for _ in range(10):
            resp = api_client.post(f"{API}/auth/login", json={"email": email, "password": "WrongPass!12345"})
            codes.append(resp.status_code)
        assert all(c == 401 for c in codes), f"unexpected codes in first 10 attempts: {codes}"
        resp = api_client.post(f"{API}/auth/login", json={"email": email, "password": "WrongPass!12345"})
        assert resp.status_code == 429, f"11th attempt returned {resp.status_code}: {resp.text}"
