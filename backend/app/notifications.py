"""Config de notificação (ntfy) exposta/editável pela UI.

GET devolve servidor/tópico/url pública pra tela orientar o setup no iPhone.
PUT troca o tópico em runtime (persistido no SQLite, sobrepõe o .env) — assim
dá pra rotacionar a "chave" sem reiniciar o backend. Não envia push aqui.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import httpx

from . import notify, settings_store
from .auth import current_user
from .config import settings

router = APIRouter(prefix="/api/notify", tags=["notify"])

_TOPIC_RE = re.compile(r"^[A-Za-z0-9_-]{12,64}$")


class TopicIn(BaseModel):
    topic: str


def _configured(topic: str) -> bool:
    # o placeholder do .env.example contém "troque"; tópico curto é inseguro
    return "troque" not in topic.lower() and len(topic) >= 12


def _payload() -> dict:
    topic = settings_store.ntfy_topic()
    return {
        "server": settings.ntfy_server,
        "topic": topic,
        "app_public_url": settings.app_public_url,
        "configured": _configured(topic),
    }


@router.get("/config")
def notify_config(_: str = Depends(current_user)):
    return _payload()


@router.put("/config")
def set_topic(body: TopicIn, _: str = Depends(current_user)):
    topic = body.topic.strip()
    if not _TOPIC_RE.fullmatch(topic):
        raise HTTPException(
            400, "tópico inválido: use 12–64 caracteres [A-Za-z0-9_-], sem espaços"
        )
    settings_store.set_ntfy_topic(topic)
    return _payload()


@router.post("/test")
async def send_test(_: str = Depends(current_user)):
    """Envia uma notificação de teste pelo backend (botão 'Enviar teste')."""
    try:
        await notify.send_test()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"falha ao enviar para o ntfy: {exc}")
    return {"sent": True, "topic": settings_store.ntfy_topic()}
