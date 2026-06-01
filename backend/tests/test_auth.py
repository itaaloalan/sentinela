def test_login_success(client):
    resp = client.post(
        "/api/auth/login", data={"username": "admin", "password": "secret"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


def test_login_wrong_password(client):
    resp = client.post(
        "/api/auth/login", data={"username": "admin", "password": "errada"}
    )
    assert resp.status_code == 401


def test_login_unknown_user(client):
    resp = client.post(
        "/api/auth/login", data={"username": "ninguem", "password": "secret"}
    )
    assert resp.status_code == 401


def test_protected_route_without_token(client):
    assert client.get("/api/cameras").status_code == 401


def test_protected_route_with_invalid_token(client):
    resp = client.get(
        "/api/cameras", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert resp.status_code == 401


def test_protected_route_with_valid_token(client, auth_headers):
    assert client.get("/api/cameras", headers=auth_headers).status_code == 200
