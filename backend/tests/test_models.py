import pytest


@pytest.fixture
def model_id(client, auth_headers):
    resp = client.post(
        "/api/models",
        json={"camera_id": 1, "name": "portao", "classes": ["aberto", "fechado"]},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def test_create_and_list_models(client, auth_headers, model_id):
    listed = client.get("/api/models", headers=auth_headers).json()
    assert any(m["id"] == model_id for m in listed)
    created = next(m for m in listed if m["id"] == model_id)
    assert created["status"] == "novo"
    assert created["active"] is False


def test_add_frame_ok(client, auth_headers, model_id):
    resp = client.post(
        f"/api/models/{model_id}/frames?label=aberto",
        files={"file": ("f.jpg", b"data", "image/jpeg")},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["frames"] == 1


def test_add_frame_invalid_label(client, auth_headers, model_id):
    resp = client.post(
        f"/api/models/{model_id}/frames?label=invalida",
        files={"file": ("f.jpg", b"data", "image/jpeg")},
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_add_frame_model_not_found(client, auth_headers):
    resp = client.post(
        "/api/models/9999/frames?label=aberto",
        files={"file": ("f.jpg", b"data", "image/jpeg")},
        headers=auth_headers,
    )
    assert resp.status_code == 404


def test_set_crop(client, auth_headers, model_id):
    resp = client.put(
        f"/api/models/{model_id}/crop",
        json={"x1": 1, "y1": 2, "x2": 3, "y2": 4},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["crop"] == {"x1": 1, "y1": 2, "x2": 3, "y2": 4}


def test_train(client, auth_headers, model_id):
    resp = client.post(f"/api/models/{model_id}/train", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "treinando"


def test_status(client, auth_headers, model_id):
    resp = client.get(f"/api/models/{model_id}/status", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "novo"


def test_test_endpoint(client, auth_headers, model_id):
    resp = client.post(f"/api/models/{model_id}/test", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["label"] is None


def test_activate_and_deactivate(client, auth_headers, model_id):
    on = client.post(f"/api/models/{model_id}/activate?active=true", headers=auth_headers)
    assert on.json()["active"] is True
    off = client.post(
        f"/api/models/{model_id}/activate?active=false", headers=auth_headers
    )
    assert off.json()["active"] is False


def test_status_model_not_found(client, auth_headers):
    assert client.get("/api/models/9999/status", headers=auth_headers).status_code == 404
