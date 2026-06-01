import httpx

from app import family


def _make_familiar(client, auth_headers, username="maria", password="senha123"):
    client.post(
        "/api/family/users",
        json={"username": username, "password": password, "role": "familiar"},
        headers=auth_headers,
    )
    token = client.post(
        "/api/auth/login", data={"username": username, "password": password}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_login_returns_role(client):
    body = client.post("/api/auth/login", data={"username": "admin", "password": "secret"}).json()
    assert body["role"] == "admin"


def test_users_require_admin(client):
    assert client.get("/api/family/users").status_code == 401


def test_admin_creates_and_lists_users(client, auth_headers):
    resp = client.post(
        "/api/family/users",
        json={"username": "maria", "password": "senha123", "role": "familiar"},
        headers=auth_headers,
    )
    assert resp.status_code == 201 and resp.json()["role"] == "familiar"
    users = client.get("/api/family/users", headers=auth_headers).json()
    names = {u["username"] for u in users}
    assert {"admin", "maria"} <= names


def test_create_user_invalid_role(client, auth_headers):
    resp = client.post(
        "/api/family/users",
        json={"username": "x", "password": "p", "role": "rei"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


def test_create_user_duplicate(client, auth_headers):
    client.post("/api/family/users", json={"username": "ana", "password": "p", "role": "familiar"}, headers=auth_headers)
    resp = client.post("/api/family/users", json={"username": "ana", "password": "p", "role": "familiar"}, headers=auth_headers)
    assert resp.status_code == 409


def test_familiar_cannot_access_admin_endpoints(client, auth_headers):
    fam = _make_familiar(client, auth_headers)
    assert client.get("/api/family/users", headers=fam).status_code == 403
    assert client.post("/api/family/users", json={"username": "z", "password": "p"}, headers=fam).status_code == 403
    assert client.get("/api/family/views", headers=fam).status_code == 403


def test_delete_user_rules(client, auth_headers):
    uid = client.post(
        "/api/family/users",
        json={"username": "joao", "password": "p", "role": "familiar"},
        headers=auth_headers,
    ).json()["id"]
    # exclui um familiar comum → ok
    assert client.delete(f"/api/family/users/{uid}", headers=auth_headers).json() == {"deleted": uid}
    # inexistente → 404
    assert client.delete("/api/family/users/9999", headers=auth_headers).status_code == 404


def test_cannot_delete_self_or_last_admin(client, auth_headers):
    users = client.get("/api/family/users", headers=auth_headers).json()
    admin_id = next(u["id"] for u in users if u["username"] == "admin")
    # excluir a si mesmo → 400
    assert client.delete(f"/api/family/users/{admin_id}", headers=auth_headers).status_code == 400
    # como só há 1 admin, mesmo por outra via seria o último; cria 2º admin e exclui
    other = client.post(
        "/api/family/users",
        json={"username": "admin2", "password": "p", "role": "admin"},
        headers=auth_headers,
    ).json()["id"]
    assert client.delete(f"/api/family/users/{other}", headers=auth_headers).status_code == 200


def test_views_record_and_list(client, auth_headers):
    fam = _make_familiar(client, auth_headers)
    assert client.post("/api/family/views", json={"camera_id": 3}, headers=fam).status_code == 201
    client.post("/api/family/views", json={}, headers=auth_headers)  # painel inteiro
    views = client.get("/api/family/views", headers=auth_headers).json()
    assert any(v["username"] == "maria" and v["camera_id"] == 3 for v in views)
    assert any(v["camera_id"] is None for v in views)


def test_emergency_sends(client, auth_headers, monkeypatch):
    called = {"n": 0}

    async def fake_send():
        called["n"] += 1

    monkeypatch.setattr(family.notify, "send_emergency", fake_send)
    assert client.post("/api/family/emergency", headers=auth_headers).json() == {"sent": True}
    assert called["n"] == 1


def test_emergency_failure_returns_502(client, auth_headers, monkeypatch):
    async def boom():
        raise httpx.ConnectError("ntfy fora")

    monkeypatch.setattr(family.notify, "send_emergency", boom)
    assert client.post("/api/family/emergency", headers=auth_headers).status_code == 502


def test_emergency_requires_auth(client):
    assert client.post("/api/family/emergency").status_code == 401
