import sys
import types

import httpx
import respx
from sqlmodel import Session

from app import database, observations, settings_store
from app.config import settings
from app.db_models import Camera

FRAME_URL = f"{settings.go2rtc_url}/api/frame.jpeg"


def _seed_camera(name="portao") -> int:
    with Session(database.engine) as s:
        cam = Camera(name=name, source="rtsp://x", kind="rtsp")
        s.add(cam)
        s.commit()
        s.refresh(cam)
        return cam.id


def _fake_yolo_det(monkeypatch, cls_indices):
    class FakeBoxes:
        cls = cls_indices

    class FakeResult:
        boxes = FakeBoxes()
        names = {0: "person", 16: "dog"}

    class FakeYOLO:
        def __init__(self, w):
            pass

        def __call__(self, img):
            return [FakeResult()]

    mod = types.ModuleType("ultralytics")
    mod.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", mod)


def test_list_requires_auth(client):
    assert client.get("/api/observations").status_code == 401


def test_config_toggle(client, auth_headers):
    assert client.get("/api/observations/config", headers=auth_headers).json() == {"enabled": False}
    assert client.put("/api/observations/config", json={"enabled": True}, headers=auth_headers).json() == {"enabled": True}
    assert settings_store.vigilante_enabled() is True
    client.put("/api/observations/config", json={"enabled": False}, headers=auth_headers)
    assert settings_store.vigilante_enabled() is False


def test_create_without_snapshot_and_list(client, auth_headers):
    resp = client.post(
        "/api/observations",
        data={"camera_id": 1, "description": "Detectado: 1 pessoa.", "objects": "person"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["objects"] == ["person"]
    assert body["snapshot"] is None
    listed = client.get("/api/observations", headers=auth_headers).json()
    assert len(listed) == 1 and listed[0]["description"] == "Detectado: 1 pessoa."


def test_create_with_snapshot_and_fetch_it(client, auth_headers):
    resp = client.post(
        "/api/observations",
        data={"camera_id": 2, "description": "Detectado: 1 carro."},
        files={"file": ("o.jpg", b"jpegbytes", "image/jpeg")},
        headers=auth_headers,
    )
    body = resp.json()
    assert body["objects"] == []  # sem campo objects → lista vazia
    assert body["snapshot"] is not None
    snap = client.get(f"/api/observations/{body['id']}/snapshot", headers=auth_headers)
    assert snap.status_code == 200 and snap.content == b"jpegbytes"


def test_snapshot_404_when_no_snapshot(client, auth_headers):
    body = client.post(
        "/api/observations",
        data={"camera_id": 1, "description": "x"},
        headers=auth_headers,
    ).json()
    assert client.get(f"/api/observations/{body['id']}/snapshot", headers=auth_headers).status_code == 404


def test_snapshot_404_when_missing_id(client, auth_headers):
    assert client.get("/api/observations/999/snapshot", headers=auth_headers).status_code == 404


def test_snapshot_404_when_file_gone(client, auth_headers, monkeypatch, tmp_path):
    from app import observations

    body = client.post(
        "/api/observations",
        data={"camera_id": 1, "description": "x"},
        files={"file": ("o.jpg", b"j", "image/jpeg")},
        headers=auth_headers,
    ).json()
    # aponta o dir de snapshots pra um lugar vazio → arquivo some
    monkeypatch.setattr(observations, "_obs_dir", lambda: tmp_path / "vazio")
    assert client.get(f"/api/observations/{body['id']}/snapshot", headers=auth_headers).status_code == 404


def test_create_requires_auth(client):
    assert client.post("/api/observations", data={"camera_id": 1, "description": "x"}).status_code == 401


# ---- "Descrever agora" (testar o vigilante pela UI) ----


def _jpeg() -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (16, 16), "white").save(buf, "JPEG")
    return buf.getvalue()


def test_describe_frame_lists_objects(monkeypatch):
    _fake_yolo_det(monkeypatch, [0, 0, 16])
    text, objs = observations.describe_frame(_jpeg())
    assert objs == ["person", "person", "dog"]
    assert "2 pessoas" in text and "1 cachorro" in text


def test_describe_frame_empty(monkeypatch):
    _fake_yolo_det(monkeypatch, [])
    assert observations.describe_frame(_jpeg()) == ("", [])


def test_test_describe_saves_observation(client, auth_headers, monkeypatch):
    cam = _seed_camera("portao")
    _fake_yolo_det(monkeypatch, [0])
    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=_jpeg()))
        body = client.post(f"/api/observations/test?camera_id={cam}", headers=auth_headers).json()
    assert body["saved"] is True and body["objects"] == ["person"]
    listed = client.get("/api/observations", headers=auth_headers).json()
    assert len(listed) == 1


def test_test_describe_nothing_detected(client, auth_headers, monkeypatch):
    cam = _seed_camera("portao")
    _fake_yolo_det(monkeypatch, [])
    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=_jpeg()))
        body = client.post(f"/api/observations/test?camera_id={cam}", headers=auth_headers).json()
    assert body["saved"] is False


def test_test_describe_camera_not_found(client, auth_headers):
    assert client.post("/api/observations/test?camera_id=999", headers=auth_headers).status_code == 404


def test_test_describe_frame_unavailable(client, auth_headers):
    cam = _seed_camera("portao")
    with respx.mock:
        respx.get(FRAME_URL).mock(side_effect=httpx.ConnectError("fora"))
        assert client.post(f"/api/observations/test?camera_id={cam}", headers=auth_headers).status_code == 502


def test_test_describe_empty_frame(client, auth_headers):
    cam = _seed_camera("portao")
    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=b""))
        assert client.post(f"/api/observations/test?camera_id={cam}", headers=auth_headers).status_code == 502
