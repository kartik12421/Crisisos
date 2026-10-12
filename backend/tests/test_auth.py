"""CrisisOS iteration-4 auth tests: signup/login/me, role guards, citizen scoping.

Covers: POST /api/auth/signup (201, 409 duplicate, 422 short password),
POST /api/auth/login (200 per role, 401 wrong password), GET /api/auth/me,
401 on unauthenticated protected routes, 403 citizen role guards, and
citizens only seeing their OWN incidents.
"""
import uuid

from conftest import API, CREDENTIALS


class TestSignup:
    """Self-signup always creates CITIZEN accounts."""

    def test_signup_success_returns_citizen_token(self, api_client):
        email = f"TEST-signup-{uuid.uuid4().hex[:8]}@crisisos.app"
        resp = api_client.post(f"{API}/auth/signup", json={
            "name": "Test Signup", "email": email, "password": "TestPass!2026x",
        })
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["access_token"]
        assert data["token_type"] == "bearer"
        assert data["user"]["role"] == "CITIZEN"
        assert data["user"]["email"] == email.lower()  # server normalizes email to lowercase
        TestSignup.email = email

    def test_signup_duplicate_email_409(self, api_client):
        resp = api_client.post(f"{API}/auth/signup", json={
            "name": "Test Dup", "email": TestSignup.email, "password": "TestPass!2026x",
        })
        assert resp.status_code == 409

    def test_signup_short_password_422(self, api_client):
        resp = api_client.post(f"{API}/auth/signup", json={
            "name": "Test Short", "email": f"TEST-short-{uuid.uuid4().hex[:6]}@crisisos.app",
            "password": "short",
        })
        assert resp.status_code == 422

    def test_signup_invalid_email_422(self, api_client):
        resp = api_client.post(f"{API}/auth/signup", json={
            "name": "Test Bad", "email": "not-an-email", "password": "TestPass!2026x",
        })
        assert resp.status_code == 422


class TestLogin:
    """Seeded role logins and wrong-password rejection."""

    def test_login_all_seeded_roles(self, api_client):
        for role, (email, password) in CREDENTIALS.items():
            resp = api_client.post(f"{API}/auth/login", json={"email": email, "password": password})
            assert resp.status_code == 200, f"{role}: {resp.text}"
            data = resp.json()
            assert data["user"]["role"] == role, f"{email} returned {data['user']['role']}"
            assert data["user"]["email"] == email
            assert data["access_token"]

    def test_login_wrong_password_401(self, api_client):
        resp = api_client.post(f"{API}/auth/login", json={
            "email": "citizen@crisisos.app", "password": "WrongPass!2026",
        })
        assert resp.status_code == 401

    def test_login_unknown_email_401(self, api_client):
        resp = api_client.post(f"{API}/auth/login", json={
            "email": "ghost@crisisos.app", "password": "Whatever!2026",
        })
        assert resp.status_code == 401


class TestMe:
    """GET /api/auth/me with Bearer token."""

    def test_me_returns_profile(self, api_client, tokens, auth):
        resp = api_client.get(f"{API}/auth/me", headers=auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "operator@crisisos.app"
        assert data["role"] == "OPERATOR"

    def test_me_no_token_401(self, api_client):
        assert api_client.get(f"{API}/auth/me").status_code == 401

    def test_me_garbage_token_401(self, api_client):
        resp = api_client.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
        assert resp.status_code == 401


class TestUnauthenticatedGuards:
    """Protected routes must 401 without a token."""

    def test_incidents_401(self, api_client):
        assert api_client.get(f"{API}/incidents").status_code == 401

    def test_sos_401(self, api_client):
        resp = api_client.post(f"{API}/sos", json={
            "emergency_type": "FIRE", "affected_people": 1, "idempotency_key": f"TEST-{uuid.uuid4()}",
        })
        assert resp.status_code == 401

    def test_responders_401(self, api_client):
        assert api_client.get(f"{API}/responders").status_code == 401

    def test_analytics_401(self, api_client):
        assert api_client.get(f"{API}/analytics").status_code == 401

    def test_alerts_list_401(self, api_client):
        assert api_client.get(f"{API}/alerts").status_code == 401

    def test_upload_401(self, api_client):
        resp = api_client.post(f"{API}/upload", files={"file": ("a.png", b"\x89PNG\r\n\x1a\n", "image/png")})
        assert resp.status_code == 401


class TestCitizenRoleGuards:
    """Citizens must get 403 on operator/responder surfaces."""

    def test_citizen_cannot_approve_dispatch(self, api_client, auth):
        resp = api_client.post(f"{API}/incidents/whatever/approve-dispatch",
                               json={"responder_id": "responder-alpha"}, headers=auth("CITIZEN"))
        assert resp.status_code == 403

    def test_citizen_cannot_publish_alert(self, api_client, auth):
        resp = api_client.post(f"{API}/alerts", json={
            "title": "TEST citizen alert", "message": "should be rejected", "severity": "INFO",
        }, headers=auth("CITIZEN"))
        assert resp.status_code == 403

    def test_citizen_cannot_view_analytics(self, api_client, auth):
        assert api_client.get(f"{API}/analytics", headers=auth("CITIZEN")).status_code == 403

    def test_citizen_cannot_view_audit(self, api_client, auth):
        assert api_client.get(f"{API}/audit", headers=auth("CITIZEN")).status_code == 403

    def test_citizen_cannot_view_responders(self, api_client, auth):
        assert api_client.get(f"{API}/responders", headers=auth("CITIZEN")).status_code == 403

    def test_citizen_cannot_view_assignments(self, api_client, auth):
        assert api_client.get(f"{API}/assignments", headers=auth("CITIZEN")).status_code == 403


class TestCitizenIncidentScoping:
    """Citizens only see THEIR OWN incidents (reported_by filter)."""

    def test_citizens_isolated_from_each_other(self, api_client, auth):
        # Citizen A (seeded) creates an SOS.
        resp = api_client.post(f"{API}/sos", json={
            "emergency_type": "FLOOD", "description": "TEST scoping flood", "affected_people": 2,
            "idempotency_key": f"TEST-scope-{uuid.uuid4()}",
        }, headers=auth("CITIZEN"), timeout=40)
        assert resp.status_code == 201, resp.text
        incident_id = resp.json()["id"]

        # Citizen B (fresh signup) must not see it anywhere.
        resp = api_client.post(f"{API}/auth/signup", json={
            "name": "Test Bystander", "email": f"TEST-scope-{uuid.uuid4().hex[:8]}@crisisos.app",
            "password": "TestPass!2026x",
        })
        assert resp.status_code == 201
        b_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

        listed = api_client.get(f"{API}/incidents", headers=b_headers)
        assert listed.status_code == 200
        assert incident_id not in [i["id"] for i in listed.json()]

        direct = api_client.get(f"{API}/incidents/{incident_id}", headers=b_headers)
        assert direct.status_code == 403

        # Owner sees their own incident; operator sees the full queue.
        own = api_client.get(f"{API}/incidents", headers=auth("CITIZEN"))
        assert incident_id in [i["id"] for i in own.json()]
        ops = api_client.get(f"{API}/incidents", headers=auth("OPERATOR"))
        assert incident_id in [i["id"] for i in ops.json()]
