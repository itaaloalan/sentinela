"""Settings editáveis em runtime (sobrepõem o .env), persistidas no SQLite.

Hoje só o tópico do ntfy. Permite trocar a "chave" pela tela de Notificações
sem mexer no .env / reiniciar o backend.
"""
from sqlmodel import Session

from .config import settings
from .database import engine
from .db_models import Setting

_NTFY_TOPIC = "ntfy_topic"
_DISCORD_WEBHOOK = "discord_webhook"


def _get(key: str, default: str) -> str:
    with Session(engine) as session:
        rec = session.get(Setting, key)
        return rec.value if rec else default


def _set(key: str, value: str) -> None:
    with Session(engine) as session:
        rec = session.get(Setting, key)
        if rec is None:
            rec = Setting(key=key, value=value)
        else:
            rec.value = value
        session.add(rec)
        session.commit()


def ntfy_topic() -> str:
    """Tópico efetivo: o salvo no banco ou, se nunca trocado, o do .env."""
    return _get(_NTFY_TOPIC, settings.ntfy_topic)


def set_ntfy_topic(value: str) -> None:
    _set(_NTFY_TOPIC, value)


def discord_webhook() -> str:
    """Webhook do Discord efetivo (banco → .env). Vazio = Discord desligado."""
    return _get(_DISCORD_WEBHOOK, settings.discord_webhook)


def set_discord_webhook(value: str) -> None:
    _set(_DISCORD_WEBHOOK, value)


_AI_HEARTBEAT = "ai_heartbeat"


def ai_heartbeat() -> str:
    """Último epoch (str) em que o monitor de IA deu sinal de vida; '' se nunca."""
    return _get(_AI_HEARTBEAT, "")


def set_ai_heartbeat(value: str) -> None:
    _set(_AI_HEARTBEAT, value)
