"""CrisisOS realtime + AI triage tests - iteration 4 (auth-enabled).

Covers:
- WS /api/ws accepts connections, answers ping with pong, and broadcasts
  incident.created, assignment.updated, responder.location, responder.status
  and alert.published events.
- POST /api/sos runs OpenAI gpt-5.6-terra triage (provider field, structured
  analysis, human_approval_required always true) within the 25s budget.
- Deterministic safety fallback exists and is well-formed (unit-level).
"""
import asyncio
import json
import sys
import time
import uuid

import pytest
import websockets

from conftest import API, ws_url


def _make_sos(api_client, headers, emergency_type="FIRE", description="TEST ws fire at warehouse", people=2):
    key = f"TEST-ws-{uuid.uuid4()}"
    payload = {
        "emergency_type": emergency_type,
        "description": description,
        "affected_people": people,
        "idempotency_key": key,
        "location": {"type": "Point", "coordinates": [77.59, 12.97], "source": "CURRENT_GPS"},
    }
    return api_client.post(f"{API}/sos", json=payload, headers=headers, timeout=40)


async def _collect_events(trigger, expected_types, url, timeout=20):
    """Open an authenticated WS, fire `trigger` (sync callable run in a thread), collect events."""
    received = []
    async with websockets.connect(url, open_timeout=10) as ws:
        loop = asyncio.get_running_loop()
        fut = loop.run_in_executor(None, trigger)
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.5, deadline - loop.time()))
                received.append(json.loads(raw))
                types = {e.get("type") for e in received}
                if expected_types.issubset(types):
                    break
            except asyncio.TimeoutError:
                break
        await fut
    return received


class TestRealtimeWebSocket:
    """Realtime event fan-out over /api/ws."""

    def test_ws_accepts_connection(self, tokens):
        async def probe():
            async with websockets.connect(ws_url(tokens["CITIZEN"]), open_timeout=10):
                return True
        assert asyncio.run(probe()) is True

    def test_ws_ping_pong_heartbeat(self, tokens):
        """Server answers 'ping' with a pong frame (client heartbeat support)."""
        async def probe():
            async with websockets.connect(ws_url(tokens["OPERATOR"]), open_timeout=10) as ws:
                await ws.send("ping")
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                return json.loads(raw)
        event = asyncio.run(probe())
        assert event["type"] == "pong"

    def test_incident_created_broadcast(self, api_client, auth, tokens):
        holder = {}
        def trigger():
            holder["resp"] = _make_sos(api_client, auth("CITIZEN"))
        events = asyncio.run(_collect_events(trigger, {"incident.created"}, ws_url(tokens["CITIZEN"]), timeout=25))
        created = [e for e in events if e.get("type") == "incident.created"]
        assert created, f"no incident.created within window; got {[e.get('type') for e in events]}"
        assert holder["resp"].status_code == 201
        incident_id = holder["resp"].json()["id"]
        # shared preview backend: other clients may create SOS concurrently — ours must appear
        assert incident_id in {e["payload"].get("incident_id") for e in created}, \
            f"our incident not broadcast; got {[e['payload'].get('incident_id') for e in created]}"
        assert "at" in created[0]
        self.__class__.incident_id = incident_id

    def test_assignment_and_responder_broadcasts(self, api_client, auth, tokens):
        incident_id = TestRealtimeWebSocket.incident_id
        responders = api_client.get(f"{API}/responders", headers=auth("OPERATOR")).json()
        rid = responders[0]["id"]

        def trigger():
            r1 = api_client.post(f"{API}/incidents/{incident_id}/approve-dispatch",
                                 json={"responder_id": rid}, headers=auth("OPERATOR"), timeout=20)
            assert r1.status_code == 201
            aid = r1.json()["id"]
            r2 = api_client.patch(f"{API}/assignments/{aid}/status",
                                  json={"status": "ACCEPTED", "note": "TEST ws"},
                                  headers=auth("RESPONDER"), timeout=20)
            assert r2.status_code == 200
            r3 = api_client.patch(f"{API}/responders/{rid}/location", json={"location": {
                "type": "Point", "coordinates": [77.61, 12.99], "source": "CURRENT_GPS",
                "accuracy": 12, "timestamp": "2026-01-02T00:00:00Z"}}, headers=auth("RESPONDER"), timeout=20)
            assert r3.status_code == 200
            r4 = api_client.patch(f"{API}/responders/{rid}/status", json={"status": "EN_ROUTE"},
                                  headers=auth("RESPONDER"), timeout=20)
            assert r4.status_code == 200

        # responder.location is privileged — observe with an OPERATOR socket
        events = asyncio.run(_collect_events(
            trigger, {"assignment.updated", "responder.location", "responder.status"},
            ws_url(tokens["OPERATOR"]), timeout=25))
        types = [e.get("type") for e in events]
        assert "assignment.updated" in types, f"missing assignment.updated; got {types}"
        assert "responder.location" in types, f"missing responder.location; got {types}"
        assert "responder.status" in types, f"missing responder.status; got {types}"
        loc = next(e for e in events if e["type"] == "responder.location")
        assert loc["payload"]["responder_id"] == rid

    def test_alert_published_broadcast(self, api_client, auth, tokens):
        holder = {}
        def trigger():
            holder["resp"] = api_client.post(f"{API}/alerts", json={
                "title": "TEST ws alert", "message": "Realtime alert broadcast check.",
                "severity": "WARNING",
            }, headers=auth("OPERATOR"), timeout=20)
        events = asyncio.run(_collect_events(trigger, {"alert.published"}, ws_url(tokens["OPERATOR"]), timeout=20))
        assert holder["resp"].status_code == 201
        alert_id = holder["resp"].json()["id"]
        published = [e for e in events if e.get("type") == "alert.published"]
        assert published, f"alert.published missing from received events; got {[e.get('type') for e in events]}"
        assert alert_id in {e["payload"].get("alert_id") for e in published}
        payload = published[0]["payload"]
        assert payload.get("title") == "TEST ws alert"
        assert payload.get("message") == "Realtime alert broadcast check."
        # cleanup so the alert does not linger for other suites
        api_client.post(f"{API}/alerts/{alert_id}/deactivate", headers=auth("OPERATOR"), timeout=20)


class TestAiTriage:
    """LLM-first triage via Emergent universal key."""

    def test_sos_uses_openai_gpt_triage(self, api_client, auth):
        started = time.time()
        resp = _make_sos(api_client, auth("CITIZEN"), emergency_type="MEDICAL",
                         description="TEST ai: man unconscious after fall, not breathing", people=1)
        elapsed = time.time() - started
        assert resp.status_code == 201
        data = resp.json()
        ai = data["ai_analysis"]
        assert ai["provider"] == "openai/gpt-5.6-terra", f"unexpected provider: {ai.get('provider')}"
        assert ai["human_approval_required"] is True
        assert ai["severity"] in {"LOW", "MODERATE", "HIGH", "CRITICAL"}
        assert isinstance(ai["required_capabilities"], list) and len(ai["required_capabilities"]) >= 1
        assert isinstance(ai["summary"], str) and len(ai["summary"]) > 5
        assert isinstance(ai["risks"], list) and len(ai["risks"]) >= 1
        assert 0.0 <= float(ai["confidence"]) <= 1.0
        assert elapsed < 26, f"triaged too slowly ({elapsed:.1f}s) — timeout budget exceeded"

    def test_ai_severity_and_type_reflected_on_incident(self, api_client, auth):
        resp = _make_sos(api_client, auth("CITIZEN"), emergency_type="BUILDING_COLLAPSE",
                         description="TEST ai: roof collapsed on family, multiple trapped", people=4)
        assert resp.status_code == 201
        data = resp.json()
        ai = data["ai_analysis"]
        assert data["severity"] == ai["severity"]
        assert data["type"] == ai["type"]

    def test_deterministic_fallback_wellformed(self):
        """Unit-level: deterministic safety provider must remain intact as fallback."""
        sys.path.insert(0, "/app/backend")
        try:
            from server import SOSCreate, analysis_for
        except Exception as exc:
            pytest.skip(f"server module not importable here: {exc}")
        sos = SOSCreate(emergency_type="TRAPPED_PERSON", description="stuck under rubble",
                        affected_people=2, idempotency_key="TEST-unit-fallback-1")
        ai = analysis_for(sos)
        assert ai["provider"] == "deterministic-safety-provider"
        assert ai["human_approval_required"] is True
        assert ai["severity"] == "CRITICAL"
        assert "BUILDING_RESCUE" in ai["required_capabilities"]
