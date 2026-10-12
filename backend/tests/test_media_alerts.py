"""CrisisOS iteration-4 media + alerts tests.

Covers: POST /api/upload (auth, image-only, 8MB cap), GET /api/files/{path}
(signed URL + Authorization header, 401 without; raw ?token= rejected), SOS media_paths
ownership filtering, alerts publish/list/deactivate with role guards, and
the extended /api/analytics fields.
"""
import uuid

from conftest import API, BASE_URL

# 1x1 transparent PNG
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000d49444154789c626001000000ffff030000060005"
    "57bfabd40000000049454e44ae426082"
)


def _upload(api_client, headers, filename, content, content_type):
    """Multipart POST. Content-Type=None drops the session's JSON default so
    `requests` can set the multipart boundary itself."""
    return api_client.post(
        f"{API}/upload",
        files={"file": (filename, content, content_type)},
        headers={"Content-Type": None, **headers},
    )


class TestUpload:
    """POST /api/upload stores images in Emergent object storage."""

    def test_upload_image_success(self, api_client, auth):
        resp = _upload(api_client, auth("CITIZEN"), "TEST-photo.png", PNG_BYTES, "image/png")
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["path"].startswith("crisisos/uploads/")
        assert data["path"].endswith(".png")
        assert data["content_type"] == "image/png"
        TestUpload.path = data["path"]

    def test_upload_non_image_rejected_400(self, api_client, auth):
        resp = _upload(api_client, auth("CITIZEN"), "TEST-notes.txt", b"hello world", "text/plain")
        assert resp.status_code == 400

    def test_upload_oversize_rejected_413(self, api_client, auth):
        big = b"\x89PNG\r\n\x1a\n" + b"0" * (8 * 1024 * 1024 + 1)
        resp = _upload(api_client, auth("CITIZEN"), "TEST-big.png", big, "image/png")
        assert resp.status_code == 413


class TestFileDownload:
    """GET /api/files/{path}: signed URL (web) or Authorization header (native).
    Raw JWTs in ?token= are NO LONGER accepted (SEC-004 — full matrix in
    test_security.py)."""

    def test_download_with_signed_url(self, api_client, auth):
        sign = api_client.get(f"{API}/media/sign?path={TestUpload.path}", headers=auth("CITIZEN"))
        assert sign.status_code == 200, sign.text
        resp = api_client.get(f"{BASE_URL}{sign.json()['url']}")  # no auth header
        assert resp.status_code == 200, resp.text
        assert resp.content == PNG_BYTES

    def test_download_with_authorization_header(self, api_client, auth):
        resp = api_client.get(f"{API}/files/{TestUpload.path}", headers=auth("OPERATOR"))
        assert resp.status_code == 200
        assert resp.content == PNG_BYTES

    def test_download_no_token_401(self, api_client):
        assert api_client.get(f"{API}/files/{TestUpload.path}").status_code == 401

    def test_download_raw_jwt_query_rejected_401(self, api_client, tokens):
        resp = api_client.get(f"{API}/files/{TestUpload.path}?token={tokens['CITIZEN']}")
        assert resp.status_code == 401

    def test_download_unknown_path_404(self, api_client, auth):
        resp = api_client.get(f"{API}/files/crisisos/uploads/nobody/missing.png", headers=auth("CITIZEN"))
        assert resp.status_code == 404


class TestSosMediaAttachment:
    """SOS media_paths attach ONLY the uploader's own media."""

    def test_own_media_attached_to_incident(self, api_client, auth):
        resp = api_client.post(f"{API}/sos", json={
            "emergency_type": "FIRE", "description": "TEST sos with photo evidence",
            "affected_people": 1, "idempotency_key": f"TEST-media-{uuid.uuid4()}",
            "media_paths": [TestUpload.path],
        }, headers=auth("CITIZEN"), timeout=40)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert len(data["media"]) == 1
        assert data["media"][0]["path"] == TestUpload.path

    def test_foreign_media_filtered_out(self, api_client, auth):
        # Operator uploads; citizen tries to attach the operator's media.
        up = _upload(api_client, auth("OPERATOR"), "TEST-ops.png", PNG_BYTES, "image/png")
        assert up.status_code == 201, up.text
        foreign_path = up.json()["path"]
        resp = api_client.post(f"{API}/sos", json={
            "emergency_type": "FIRE", "description": "TEST foreign media attach attempt",
            "affected_people": 1, "idempotency_key": f"TEST-media-{uuid.uuid4()}",
            "media_paths": [foreign_path],
        }, headers=auth("CITIZEN"), timeout=40)
        assert resp.status_code == 201, resp.text
        assert resp.json()["media"] == []


class TestAlerts:
    """Operator publishes; any authenticated role lists; operator deactivates."""

    def test_operator_publishes_alert(self, api_client, auth):
        resp = api_client.post(f"{API}/alerts", json={
            "title": "TEST Flood warning", "message": "Avoid low-lying roads near the river.",
            "severity": "CRITICAL", "radius_km": 12.5,
        }, headers=auth("OPERATOR"))
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["severity"] == "CRITICAL"
        assert data["radius_km"] == 12.5
        assert data["active"] is True
        assert data["created_by"] == "operator@crisisos.app"
        TestAlerts.alert_id = data["id"]

    def test_citizen_lists_alerts(self, api_client, auth):
        resp = api_client.get(f"{API}/alerts", headers=auth("CITIZEN"))
        assert resp.status_code == 200
        alerts = resp.json()
        assert any(a["id"] == TestAlerts.alert_id for a in alerts)

    def test_alert_validation_422(self, api_client, auth):
        resp = api_client.post(f"{API}/alerts", json={
            "title": "x", "message": "y", "severity": "BOGUS",
        }, headers=auth("OPERATOR"))
        assert resp.status_code == 422

    def test_deactivate_alert(self, api_client, auth):
        resp = api_client.post(f"{API}/alerts/{TestAlerts.alert_id}/deactivate", headers=auth("OPERATOR"))
        assert resp.status_code == 200
        assert resp.json()["active"] is False
        active = api_client.get(f"{API}/alerts", headers=auth("CITIZEN")).json()
        assert TestAlerts.alert_id not in [a["id"] for a in active]
        # still visible when active_only=false
        all_alerts = api_client.get(f"{API}/alerts?active_only=false", headers=auth("CITIZEN")).json()
        assert TestAlerts.alert_id in [a["id"] for a in all_alerts]

    def test_deactivate_unknown_404(self, api_client, auth):
        resp = api_client.post(f"{API}/alerts/nope/deactivate", headers=auth("OPERATOR"))
        assert resp.status_code == 404


class TestAnalyticsExtended:
    """GET /api/analytics returns the extended dashboard fields."""

    def test_extended_fields_present(self, api_client, auth):
        resp = api_client.get(f"{API}/analytics", headers=auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        for key in ("total_emergencies", "active_incidents", "critical_incidents",
                    "human_approvals", "by_type", "by_severity",
                    "avg_resolution_minutes", "active_alerts", "responders_available"):
            assert key in data, f"missing analytics field: {key}"
        assert isinstance(data["by_type"], dict)
        assert isinstance(data["by_severity"], dict)
        assert isinstance(data["active_alerts"], int)
        assert isinstance(data["responders_available"], int)
        assert data["total_emergencies"] >= 1  # SOS media tests above

    def test_responder_cannot_view_analytics(self, api_client, auth):
        assert api_client.get(f"{API}/analytics", headers=auth("RESPONDER")).status_code == 403
