import types

import httpx
import respx
from sqlmodel import Session

from app import database, settings_store, status
from app.config import settings
from app.db_models import Camera, Event

STREAMS_URL = f"{settings.go2rtc_url}/api/streams"
LOG_URL = f"{settings.go2rtc_url}/api/log"


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


# ---- saúde / dashboard ----


def test_health_requires_auth(client):
    assert client.get("/api/status/health").status_code == 401


def test_health_full(client, auth_headers, monkeypatch):
    with Session(database.engine) as s:
        s.add(Camera(name="portao", source="rtsp://x", kind="rtsp"))
        s.add(Event(model_id=1, camera_id=1, label="aberto", snapshot="a.jpg"))
        s.commit()
    monkeypatch.setattr(status, "_disk", lambda: {"total": 100, "used": 40, "free": 60, "percent": 40.0})
    monkeypatch.setattr(status, "_cpu_temp", lambda: 51.2)
    monkeypatch.setattr(status, "_now", lambda: 100.0)
    settings_store.set_ai_heartbeat("0")  # 100s atrás → IA offline
    with respx.mock:
        respx.get(STREAMS_URL).mock(
            return_value=httpx.Response(200, json={"portao": {"producers": [{"id": 1}]}})
        )
        respx.get(LOG_URL).mock(return_value=httpx.Response(200, text="linha1\nlinha2"))
        body = client.get("/api/status/health", headers=auth_headers).json()
    assert body["events_today"] == 1
    assert body["disk"]["percent"] == 40.0
    assert body["temperature_c"] == 51.2
    assert body["cameras"] == [{"name": "portao", "online": True}]
    assert body["go2rtc"] == {"reachable": True, "log": ["linha1", "linha2"]}
    assert body["ai"] == {"online": False, "last_seen_seconds": 100.0}


def test_health_go2rtc_down_and_no_heartbeat(client, auth_headers, monkeypatch):
    with Session(database.engine) as s:
        s.add(Camera(name="portao", source="rtsp://x", kind="rtsp"))
        s.commit()
    monkeypatch.setattr(status, "_disk", lambda: None)
    monkeypatch.setattr(status, "_cpu_temp", lambda: None)
    with respx.mock:
        respx.get(STREAMS_URL).mock(side_effect=httpx.ConnectError("fora"))
        respx.get(LOG_URL).mock(side_effect=httpx.ConnectError("fora"))
        body = client.get("/api/status/health", headers=auth_headers).json()
    assert body["disk"] is None
    assert body["temperature_c"] is None
    assert body["cameras"] == [{"name": "portao", "online": False}]
    assert body["go2rtc"] == {"reachable": False, "log": []}
    assert body["ai"]["last_seen_seconds"] is None


def test_disk_success(monkeypatch):
    monkeypatch.setattr(
        status.shutil, "disk_usage", lambda p: types.SimpleNamespace(total=200, used=50, free=150)
    )
    assert status._disk() == {"total": 200, "used": 50, "free": 150, "percent": 25.0}


def test_disk_zero_total(monkeypatch):
    monkeypatch.setattr(
        status.shutil, "disk_usage", lambda p: types.SimpleNamespace(total=0, used=0, free=0)
    )
    assert status._disk()["percent"] == 0.0


def test_disk_missing_path(monkeypatch):
    def boom(_):
        raise OSError("sem caminho")

    monkeypatch.setattr(status.shutil, "disk_usage", boom)
    assert status._disk() is None


def test_cpu_temp_reads_celsius(monkeypatch, tmp_path):
    p = tmp_path / "temp"
    p.write_text("51200\n")
    monkeypatch.setattr(status, "_TEMP_PATH", str(p))
    assert status._cpu_temp() == 51.2


def test_cpu_temp_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(status, "_TEMP_PATH", str(tmp_path / "nao-existe"))
    assert status._cpu_temp() is None


def test_cpu_temp_garbage(monkeypatch, tmp_path):
    p = tmp_path / "temp"
    p.write_text("xyz")
    monkeypatch.setattr(status, "_TEMP_PATH", str(p))
    assert status._cpu_temp() is None
