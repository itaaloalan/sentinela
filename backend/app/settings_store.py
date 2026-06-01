"""Settings editáveis em runtime (sobrepõem o .env), persistidas no SQLite.

Hoje só o tópico do ntfy. Permite trocar a "chave" pela tela de Notificações
sem mexer no .env / reiniciar o backend.
"""
from sqlmodel import Session

from .config import settings
from .database import engine
from .db_models import Setting

_NTFY_TOPIC = "ntfy_topic"


def ntfy_topic() -> str:
    """Tópico efetivo: o salvo no banco ou, se nunca trocado, o do .env."""
    with Session(engine) as session:
        rec = session.get(Setting, _NTFY_TOPIC)
        return rec.value if rec else settings.ntfy_topic


def set_ntfy_topic(value: str) -> None:
    with Session(engine) as session:
        rec = session.get(Setting, _NTFY_TOPIC)
        if rec is None:
            rec = Setting(key=_NTFY_TOPIC, value=value)
        else:
            rec.value = value
        session.add(rec)
        session.commit()
