from fastapi.testclient import TestClient

from app.main import app


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ok",
        "service": "sentinela-backend",
        "version": "0.1.0",
    }


def test_lifespan_runs_init_db():
    """Usar o TestClient como context manager dispara o lifespan (init_db)."""
    with TestClient(app) as c:
        assert c.get("/health").status_code == 200
