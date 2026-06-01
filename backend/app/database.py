"""Engine SQLite + sessão + criação de tabelas e seed do admin (Fase 2).

Estabelece o padrão de persistência do projeto com SQLModel. O projeto usa
**SQLite** (single-user, self-hosted); por isso o `connect_args` fixo.
"""
from pathlib import Path

from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher
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
    """Cria as tabelas e garante o usuário admin. Idempotente."""
    SQLModel.metadata.create_all(eng)
    seed_admin(eng)


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
