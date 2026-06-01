import httpx
import respx

from app import settings_store, status
from app.config import settings

STREAMS_URL = f"{settings.go2rtc_url}/api/streams"


def test_status_requires_auth(client):
    assert client.get("/api/status").status_code == 401


def test_status_go2rtc_up_and_ai_via_heartbeat(client, auth_headers, monkeypatch):
    monkeypatch.setattr(status, "_now", lambda: 1000.0)
    settings_store.set_ai_heartbeat("995")  # 5s atrás → fresco
    with respx.mock:
        respx.get(STREAMS_URL).mock(return_value=httpx.Response(200, json={}))
        body = client.get("/api/status", headers=auth_headers).json()
    assert body == {"backend": True, "go2rtc": True, "ai": True}


def test_status_go2rtc_down_and_ai_stale(client, auth_headers, monkeypatch):
    monkeypatch.setattr(status, "_now", lambda: 1000.0)
    settings_store.set_ai_heartbeat("900")  # 100s atrás → velho
    with respx.mock:
        respx.get(STREAMS_URL).mock(side_effect=httpx.ConnectError("fora"))
        body = client.get("/api/status", headers=auth_headers).json()
    assert body == {"backend": True, "go2rtc": False, "ai": False}


def test_status_ai_down_without_heartbeat(client, auth_headers):
    with respx.mock:
        respx.get(STREAMS_URL).mock(return_value=httpx.Response(500))
        body = client.get("/api/status", headers=auth_headers).json()
    assert body["ai"] is False  # nunca houve heartbeat
    assert body["go2rtc"] is False  # 500 conta como fora


def test_heartbeat_records_timestamp(client, auth_headers, monkeypatch):
    monkeypatch.setattr(status, "_now", lambda: 4242.0)
    assert client.post("/api/status/heartbeat", headers=auth_headers).json() == {"ok": True}
    assert settings_store.ai_heartbeat() == "4242.0"


def test_heartbeat_requires_auth(client):
    assert client.post("/api/status/heartbeat").status_code == 401


def test_now_returns_float():
    assert isinstance(status._now(), float)
