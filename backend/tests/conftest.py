"""Fixtures de teste do backend.

Aponta o `DATABASE_URL` para um SQLite temporário ANTES de importar o app, de
modo que o engine real (e o `get_session`) sejam exercitados — nada de mocks de
sessão. Cada teste roda com as tabelas recriadas e o admin semeado.
"""
import os
import tempfile

# DB temporário + credenciais determinísticas, ANTES de importar o app.
_TMPDIR = tempfile.mkdtemp(prefix="sentinela-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMPDIR}/test.db"
os.environ["SENTINELA_ADMIN_USER"] = "admin"
os.environ["SENTINELA_ADMIN_PASS"] = "secret"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app import database, db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def reset_db():
    """Tabelas limpas + admin semeado por teste; também zera os stores em memória."""
    SQLModel.metadata.drop_all(database.engine)
    SQLModel.metadata.create_all(database.engine)
    database.seed_admin()
    db.ai_models.clear()
    db.events.clear()
    yield
    SQLModel.metadata.drop_all(database.engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers(client):
    resp = client.post(
        "/api/auth/login", data={"username": "admin", "password": "secret"}
    )
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
