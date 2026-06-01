import httpx
import respx
from sqlmodel import Session

from app import database
from app.config import settings
from app.db_models import Camera

FRAME_URL = f"{settings.go2rtc_url}/api/frame.jpeg"


def _make_camera(name="portao"):
    with Session(database.engine) as s:
        cam = Camera(name=name, source="rtsp://x")
        s.add(cam)
        s.commit()
        s.refresh(cam)
        return cam.id


def _create_model(client, auth_headers, camera_id):
    resp = client.post(
        "/api/models",
        json={"camera_id": camera_id, "name": "portao", "classes": ["aberto", "fechado"]},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _capture(client, auth_headers, mid, label="aberto"):
    with respx.mock(assert_all_mocked=False) as router:
        router.get(FRAME_URL).mock(return_value=httpx.Response(200, content=b"\xff\xd8jpeg"))
        return client.post(f"/api/models/{mid}/capture?label={label}", headers=auth_headers)


def test_create_and_list_models(client, auth_headers):
    cid = _make_camera()
    model = _create_model(client, auth_headers, cid)
    assert model["status"] == "novo"
    assert model["classes"] == ["aberto", "fechado"]
    assert model["crop"] is None
    assert model["frames"] == {"aberto": 0, "fechado": 0}
    listed = client.get("/api/models", headers=auth_headers).json()
    assert any(m["id"] == model["id"] for m in listed)


def test_model_not_found(client, auth_headers):
    assert client.get("/api/models/9999/status", headers=auth_headers).status_code == 404


def test_capture_ok(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = _capture(client, auth_headers, mid, "aberto")
    assert resp.status_code == 200
    assert resp.json() == {"label": "aberto", "frames": 1}


def test_capture_invalid_label(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.post(f"/api/models/{mid}/capture?label=zzz", headers=auth_headers)
    assert resp.status_code == 400


def test_capture_camera_missing(client, auth_headers):
    # modelo aponta para uma câmera inexistente
    mid = _create_model(client, auth_headers, 9999)["id"]
    resp = client.post(f"/api/models/{mid}/capture?label=aberto", headers=auth_headers)
    assert resp.status_code == 400


def test_capture_go2rtc_unavailable(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    with respx.mock(assert_all_mocked=False) as router:
        router.get(FRAME_URL).mock(side_effect=httpx.ConnectError("recusado"))
        resp = client.post(f"/api/models/{mid}/capture?label=aberto", headers=auth_headers)
    assert resp.status_code == 502


def test_capture_model_not_found(client, auth_headers):
    resp = client.post("/api/models/9999/capture?label=aberto", headers=auth_headers)
    assert resp.status_code == 404


def test_list_frames_and_get_image(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    _capture(client, auth_headers, mid, "aberto")
    frames_map = client.get(f"/api/models/{mid}/frames", headers=auth_headers).json()
    assert len(frames_map["aberto"]) == 1
    filename = frames_map["aberto"][0]
    img = client.get(
        f"/api/models/{mid}/frames/aberto/{filename}", headers=auth_headers
    )
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/jpeg"


def test_get_frame_image_not_found(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.get(
        f"/api/models/{mid}/frames/aberto/naoexiste.jpg", headers=auth_headers
    )
    assert resp.status_code == 404


def test_delete_frame(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    _capture(client, auth_headers, mid, "fechado")
    filename = client.get(f"/api/models/{mid}/frames", headers=auth_headers).json()["fechado"][0]
    resp = client.delete(
        f"/api/models/{mid}/frames/fechado/{filename}", headers=auth_headers
    )
    assert resp.status_code == 204
    after = client.get(f"/api/models/{mid}/frames", headers=auth_headers).json()
    assert after["fechado"] == []


def test_set_crop(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(
        f"/api/models/{mid}/crop",
        json={"x1": 1, "y1": 2, "x2": 3, "y2": 4},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["crop"] == {"x1": 1, "y1": 2, "x2": 3, "y2": 4}


def test_train_status_test(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    assert client.post(f"/api/models/{mid}/train", headers=auth_headers).json()["status"] == "treinando"
    assert client.get(f"/api/models/{mid}/status", headers=auth_headers).json()["status"] == "treinando"
    assert client.post(f"/api/models/{mid}/test", headers=auth_headers).json()["label"] is None


def test_activate_and_deactivate(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    on = client.post(f"/api/models/{mid}/activate?active=true", headers=auth_headers)
    assert on.json()["active"] is True
    off = client.post(f"/api/models/{mid}/activate?active=false", headers=auth_headers)
    assert off.json()["active"] is False
