import httpx
import respx
from sqlmodel import Session

from app import database
from app import models as models_module
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


def test_create_defaults_alert_label_and_debounce(client, auth_headers):
    cid = _make_camera()
    model = _create_model(client, auth_headers, cid)
    assert model["alert_label"] == "aberto"  # 1ª classe por padrão
    assert model["debounce_seconds"] == settings.ai_open_debounce_seconds


def test_create_with_custom_classes_and_alert_label(client, auth_headers):
    cid = _make_camera()
    resp = client.post(
        "/api/models",
        json={
            "camera_id": cid,
            "name": "vazamento pia",
            "classes": ["vazamento", "seco"],
            "alert_label": "vazamento",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["classes"] == ["vazamento", "seco"]
    assert body["alert_label"] == "vazamento"


def test_create_invalid_alert_label_falls_back_to_first(client, auth_headers):
    cid = _make_camera()
    resp = client.post(
        "/api/models",
        json={"camera_id": cid, "classes": ["a", "b"], "alert_label": "zzz"},
        headers=auth_headers,
    )
    assert resp.json()["alert_label"] == "a"


def test_update_model_renames(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(f"/api/models/{mid}", json={"name": "  novo nome  "}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "novo nome"


def test_update_model_rejects_empty_name(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(f"/api/models/{mid}", json={"name": "   "}, headers=auth_headers)
    assert resp.status_code == 400


def test_update_model_sets_alert_config(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(
        f"/api/models/{mid}",
        json={"alert_label": "fechado", "debounce_seconds": 120},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["alert_label"] == "fechado"
    assert resp.json()["debounce_seconds"] == 120


def test_update_model_rejects_alert_label_outside_classes(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(f"/api/models/{mid}", json={"alert_label": "zzz"}, headers=auth_headers)
    assert resp.status_code == 400


def test_update_model_rejects_out_of_range_debounce(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(f"/api/models/{mid}", json={"debounce_seconds": 99999}, headers=auth_headers)
    assert resp.status_code == 422  # Field(le=3600)


def test_update_model_renames_classes_and_moves_frames(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    _capture(client, auth_headers, mid, "aberto")  # frame na classe antiga
    resp = client.put(
        f"/api/models/{mid}",
        json={"classes": ["seco", "agua"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["classes"] == ["seco", "agua"]
    assert body["alert_label"] == "seco"  # alert_label antigo saiu → 1ª nova
    # o frame de 'aberto' migrou posicionalmente p/ 'seco'
    assert body["frames"]["seco"] == 1


def test_update_model_classes_keeps_unchanged_label(client, auth_headers):
    # renomeia só a 2ª classe; a 1ª ('aberto') e o alert_label permanecem
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(
        f"/api/models/{mid}",
        json={"classes": ["aberto", "parcial"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["classes"] == ["aberto", "parcial"]
    assert body["alert_label"] == "aberto"  # ainda válido → não reseta


def test_update_model_rejects_fewer_than_two_classes(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    resp = client.put(f"/api/models/{mid}", json={"classes": ["só_uma"]}, headers=auth_headers)
    assert resp.status_code == 400


def test_update_model_not_found(client, auth_headers):
    resp = client.put("/api/models/9999", json={"name": "x"}, headers=auth_headers)
    assert resp.status_code == 404


def test_delete_model_removes_record_and_frames(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    _capture(client, auth_headers, mid, "aberto")
    resp = client.delete(f"/api/models/{mid}", headers=auth_headers)
    assert resp.status_code == 204
    assert client.get(f"/api/models/{mid}/status", headers=auth_headers).status_code == 404
    assert all(m["id"] != mid for m in client.get("/api/models", headers=auth_headers).json())


def test_delete_model_not_found(client, auth_headers):
    assert client.delete("/api/models/9999", headers=auth_headers).status_code == 404


def test_update_model_empty_patch_keeps_values(client, auth_headers):
    cid = _make_camera()
    created = _create_model(client, auth_headers, cid)
    resp = client.put(f"/api/models/{created['id']}", json={}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == created["name"]
    assert resp.json()["alert_label"] == created["alert_label"]


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


def test_train_schedules_job(client, auth_headers, monkeypatch):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    scheduled = {}
    monkeypatch.setattr(
        models_module.training, "run_training", lambda m: scheduled.update(id=m)
    )
    resp = client.post(f"/api/models/{mid}/train", headers=auth_headers)
    assert resp.json()["status"] == "treinando"
    # BackgroundTasks roda após a resposta no TestClient
    assert scheduled["id"] == mid
    assert client.get(f"/api/models/{mid}/status", headers=auth_headers).json()["status"] == "treinando"


def test_test_inference_not_trained_returns_501(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    # sem pesos treinados → inference levanta RuntimeError → 501
    resp = client.post(f"/api/models/{mid}/test", headers=auth_headers)
    assert resp.status_code == 501


def test_test_inference_ok(client, auth_headers, monkeypatch):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]

    async def fake_classify(model, camera, crop):
        return {"label": "aberto", "confidence": 0.9}

    monkeypatch.setattr(models_module.inference, "classify_live", fake_classify)
    resp = client.post(f"/api/models/{mid}/test", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"label": "aberto", "confidence": 0.9}


def test_test_inference_camera_missing_returns_400(client, auth_headers):
    mid = _create_model(client, auth_headers, 9999)["id"]  # câmera inexistente
    resp = client.post(f"/api/models/{mid}/test", headers=auth_headers)
    assert resp.status_code == 400


def test_test_inference_go2rtc_down_returns_502(client, auth_headers, monkeypatch):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]

    async def boom(model, camera, crop):
        raise httpx.ConnectError("recusado")

    monkeypatch.setattr(models_module.inference, "classify_live", boom)
    resp = client.post(f"/api/models/{mid}/test", headers=auth_headers)
    assert resp.status_code == 502


def test_activate_and_deactivate(client, auth_headers):
    cid = _make_camera()
    mid = _create_model(client, auth_headers, cid)["id"]
    on = client.post(f"/api/models/{mid}/activate?active=true", headers=auth_headers)
    assert on.json()["active"] is True
    off = client.post(f"/api/models/{mid}/activate?active=false", headers=auth_headers)
    assert off.json()["active"] is False
