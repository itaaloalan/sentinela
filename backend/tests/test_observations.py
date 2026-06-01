from app import settings_store


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
