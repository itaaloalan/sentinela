"""Engine SQLite + sessão + criação de tabelas e seed do admin (Fase 2).

Estabelece o padrão de persistência do projeto com SQLModel. O projeto usa
**SQLite** (single-user, self-hosted); por isso o `connect_args` fixo.
"""
from pathlib import Path

from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher
from sqlalchemy import inspect as sa_inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings
from .db_models import Camera, User  # noqa: F401  (registra as tabelas no metadata)

password_hash = PasswordHash((BcryptHasher(),))

_SQLITE_FILE_PREFIX = "sqlite:///"


def _prepare_sqlite_dir(url: str) -> None:
    """Garante que o diretório do arquivo SQLite exista (resolve `./data`)."""
    if not url.startswith(_SQLITE_FILE_PREFIX):
        return
    db_path = url[len(_SQLITE_FILE_PREFIX):]
    if not db_path or db_path == ":memory:":
        return
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)


_prepare_sqlite_dir(settings.database_url)
engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False},
)


def init_db(eng=engine) -> None:
    """Cria as tabelas, aplica migração aditiva e garante o admin. Idempotente."""
    SQLModel.metadata.create_all(eng)
    _migrate(eng)
    seed_admin(eng)


def _migrate(eng) -> None:
    """Migração aditiva p/ SQLite (MVP sem Alembic): adiciona colunas novas.

    `create_all` não altera tabelas existentes — quando o modelo ganha uma coluna
    nova (ex.: alert_label), bancos antigos ficariam sem ela e o SELECT quebraria.
    Aqui comparamos as colunas do modelo com as do banco e fazemos ADD COLUMN nas
    que faltam (todas nullable hoje, então sem default).
    """
    insp = sa_inspect(eng)
    with eng.begin() as conn:
        for table in SQLModel.metadata.tables.values():
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in have:
                    ddl = col.type.compile(dialect=eng.dialect)
                    conn.execute(
                        text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}')
                    )


def seed_admin(eng=engine) -> None:
    """Upsert do admin a partir do `.env` (re-hasheia a senha a cada boot)."""
    with Session(eng) as session:
        user = session.exec(
            select(User).where(User.username == settings.admin_user)
        ).first()
        hashed = password_hash.hash(settings.admin_pass)
        if user is None:
            session.add(User(username=settings.admin_user, password_hash=hashed))
        else:
            user.password_hash = hashed
            session.add(user)
        session.commit()


def get_session():
    """Dependency do FastAPI: abre uma sessão por request."""
    with Session(engine) as session:
        yield session
