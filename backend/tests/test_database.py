from pathlib import Path

from sqlmodel import Session, select

from app import database
from app.db_models import User


def test_prepare_sqlite_dir_non_sqlite_url_noop(tmp_path):
    # URL não-sqlite: não cria nada.
    database._prepare_sqlite_dir("postgresql://user@host/db")
    database._prepare_sqlite_dir("sqlite://")  # in-memory sem 3 barras


def test_prepare_sqlite_dir_memory_and_empty_noop():
    database._prepare_sqlite_dir("sqlite:///:memory:")
    database._prepare_sqlite_dir("sqlite:///")


def test_prepare_sqlite_dir_creates_parent(tmp_path):
    target = tmp_path / "nested" / "deeper" / "sentinela.db"
    database._prepare_sqlite_dir(f"sqlite:///{target}")
    assert target.parent.is_dir()


def test_seed_admin_inserts_then_upserts():
    # reset_db já semeou uma vez (insert). Semear de novo exercita o ramo update.
    database.seed_admin()
    with Session(database.engine) as session:
        users = session.exec(select(User)).all()
    assert len(users) == 1
    assert database.password_hash.verify("secret", users[0].password_hash)


def test_init_db_idempotent():
    database.init_db()
    database.init_db()
    with Session(database.engine) as session:
        assert len(session.exec(select(User)).all()) == 1
