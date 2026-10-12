"""CrisisOS backend regression tests - iteration 4 (auth-enabled).

Covers: health/readiness, legacy demo auth, SOS creation + idempotency
(citizen), incidents, dispatch approval (operator only), assignment status
transitions (responder), responder location updates, analytics, audit log.
"""
import uuid

from conftest import API


class TestHealthAndAuth:
    """Health/readiness and legacy demo auth flows."""

    def test_health(self, api_client):
        resp = api_client.get(f"{API}/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_ready(self, api_client):
        resp = api_client.get(f"{API}/ready")
        assert resp.status_code == 200
        assert resp.json()["database"] == "connected"

    def test_demo_login_still_available(self, api_client):
        resp = api_client.post(f"{API}/auth/demo", json={"role": "CITIZEN"})
        assert resp.status_code == 200
        assert resp.json()["demo_mode"] is True

    def test_demo_login_invalid_role_rejected(self, api_client):
        resp = api_client.post(f"{API}/auth/demo", json={"role": "SUPERUSER"})
        assert resp.status_code == 422


class TestSosAndIncidents:
    """SOS creation (citizen), idempotency, incident listing."""

    def test_create_sos_returns_acknowledged_incident(self, api_client, auth):
        key = f"TEST-{uuid.uuid4()}"
        payload = {
            "emergency_type": "BUILDING_COLLAPSE",
            "description": "TEST building collapse, people trapped",
            "affected_people": 3,
            "idempotency_key": key,
            "location": {"type": "Point", "coordinates": [77.59, 12.97], "source": "CURRENT_GPS"},
        }
        resp = api_client.post(f"{API}/sos", json=payload, headers=auth("CITIZEN"), timeout=40)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "ACKNOWLEDGED"
        # severity is LLM-derived (non-deterministic); validate allowed set
        assert data["severity"] in {"LOW", "MODERATE", "HIGH", "CRITICAL"}
        assert data["affected_people"] == 3
        assert data["ai_analysis"]["human_approval_required"] is True
        assert "summary" in data["ai_analysis"]
        TestSosAndIncidents.incident_id = data["id"]
        TestSosAndIncidents.idem_key = key

    def test_sos_idempotency_same_key_returns_same_incident(self, api_client, auth):
        payload = {
            "emergency_type": "BUILDING_COLLAPSE",
            "description": "TEST duplicate",
            "affected_people": 1,
            "idempotency_key": TestSosAndIncidents.idem_key,
        }
        resp = api_client.post(f"{API}/sos", json=payload, headers=auth("CITIZEN"), timeout=40)
        assert resp.status_code == 201
        assert resp.json()["id"] == TestSosAndIncidents.incident_id

    def test_sos_invalid_idempotency_key_rejected(self, api_client, auth):
        resp = api_client.post(f"{API}/sos", json={
            "emergency_type": "FIRE", "affected_people": 1, "idempotency_key": "short",
        }, headers=auth("CITIZEN"))
        assert resp.status_code == 422

    def test_sos_invalid_people_count_rejected(self, api_client, auth):
        resp = api_client.post(f"{API}/sos", json={
            "emergency_type": "FIRE", "affected_people": 0, "idempotency_key": f"TEST-{uuid.uuid4()}",
        }, headers=auth("CITIZEN"))
        assert resp.status_code == 422

    def test_list_incidents_contains_created(self, api_client, auth):
        resp = api_client.get(f"{API}/incidents", headers=auth("CITIZEN"))
        assert resp.status_code == 200
        ids = [i["id"] for i in resp.json()]
        assert TestSosAndIncidents.incident_id in ids

    def test_get_incident_by_id(self, api_client, auth):
        resp = api_client.get(f"{API}/incidents/{TestSosAndIncidents.incident_id}", headers=auth("CITIZEN"))
        assert resp.status_code == 200
        assert resp.json()["id"] == TestSosAndIncidents.incident_id

    def test_get_incident_404(self, api_client, auth):
        resp = api_client.get(f"{API}/incidents/nonexistent-id", headers=auth("OPERATOR"))
        assert resp.status_code == 404


class TestDispatchAndAssignments:
    """Human-approved dispatch (operator) and responder status progression."""

    def test_responders_seeded(self, api_client, auth):
        resp = api_client.get(f"{API}/responders", headers=auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        TestDispatchAndAssignments.responder_id = data[0]["id"]

    def test_approve_dispatch_creates_assignment(self, api_client, auth):
        resp = api_client.post(
            f"{API}/incidents/{TestSosAndIncidents.incident_id}/approve-dispatch",
            json={"responder_id": TestDispatchAndAssignments.responder_id},
            headers=auth("OPERATOR"),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "ASSIGNED"
        assert data["responder_id"] == TestDispatchAndAssignments.responder_id
        assert data["approved_by"] == "operator@crisisos.app"
        TestDispatchAndAssignments.assignment_id = data["id"]
        # incident should now be ACTIVE_RESPONSE
        inc = api_client.get(f"{API}/incidents/{TestSosAndIncidents.incident_id}",
                             headers=auth("OPERATOR")).json()
        assert inc["status"] == "ACTIVE_RESPONSE"

    def test_approve_dispatch_idempotent_existing_assignment(self, api_client, auth):
        resp = api_client.post(
            f"{API}/incidents/{TestSosAndIncidents.incident_id}/approve-dispatch",
            json={"responder_id": TestDispatchAndAssignments.responder_id},
            headers=auth("OPERATOR"),
        )
        assert resp.status_code == 201
        assert resp.json()["id"] == TestDispatchAndAssignments.assignment_id

    def test_approve_dispatch_404_unknown_incident(self, api_client, auth):
        resp = api_client.post(
            f"{API}/incidents/nope/approve-dispatch",
            json={"responder_id": TestDispatchAndAssignments.responder_id},
            headers=auth("OPERATOR"),
        )
        assert resp.status_code == 404

    def test_assignment_status_progression(self, api_client, auth):
        aid = TestDispatchAndAssignments.assignment_id
        for status in ["ACCEPTED", "EN_ROUTE", "ON_SCENE", "COMPLETED"]:
            resp = api_client.patch(f"{API}/assignments/{aid}/status",
                                    json={"status": status, "note": f"TEST move to {status}"},
                                    headers=auth("RESPONDER"))
            assert resp.status_code == 200, f"failed moving to {status}: {resp.text}"
            assert resp.json()["status"] == status
        # incident should now be RESOLVED
        inc = api_client.get(f"{API}/incidents/{TestSosAndIncidents.incident_id}",
                             headers=auth("OPERATOR")).json()
        assert inc["status"] == "RESOLVED"
        # responder back to AVAILABLE
        responders = api_client.get(f"{API}/responders", headers=auth("OPERATOR")).json()
        alpha = next(r for r in responders if r["id"] == TestDispatchAndAssignments.responder_id)
        assert alpha["status"] == "AVAILABLE"

    def test_invalid_assignment_transition_rejected(self, api_client, auth):
        aid = TestDispatchAndAssignments.assignment_id
        resp = api_client.patch(f"{API}/assignments/{aid}/status", json={"status": "EN_ROUTE"},
                                headers=auth("RESPONDER"))
        assert resp.status_code == 409

    def test_update_responder_location(self, api_client, auth):
        rid = TestDispatchAndAssignments.responder_id
        resp = api_client.patch(f"{API}/responders/{rid}/location", json={
            "location": {"type": "Point", "coordinates": [77.6, 12.98], "source": "CURRENT_GPS",
                         "accuracy": 10, "timestamp": "2026-01-01T00:00:00Z"},
        }, headers=auth("RESPONDER"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["current_location"]["coordinates"] == [77.6, 12.98]

    def test_update_responder_location_404(self, api_client, auth):
        resp = api_client.patch(f"{API}/responders/ghost/location",
                                json={"location": {"type": "Point"}}, headers=auth("RESPONDER"))
        assert resp.status_code == 404


class TestAnalyticsAndAudit:
    """Analytics counters and audit trail (operator-only surfaces)."""

    def test_analytics_reflects_workflow(self, api_client, auth):
        resp = api_client.get(f"{API}/analytics", headers=auth("OPERATOR"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_emergencies"] >= 1
        assert data["human_approvals"] >= 1
        # other suites leave unresolved incidents; only check type consistency here
        assert isinstance(data["active_incidents"], int)
        assert 0 <= data["active_incidents"] <= data["total_emergencies"]

    def test_audit_log_records_key_actions(self, api_client, auth):
        resp = api_client.get(f"{API}/audit", headers=auth("OPERATOR"))
        assert resp.status_code == 200
        actions = {entry["action"] for entry in resp.json()}
        assert "USER_CREATED_SOS" in actions
        assert "DISPATCH_APPROVED" in actions
        assert "INCIDENT_RESOLVED" in actions
        assert "RESPONDER_LOCATION_UPDATED" in actions
