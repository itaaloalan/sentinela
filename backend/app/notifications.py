"""Config de notificação (ntfy) exposta pra UI orientar o setup no iPhone.

Não envia nada — só devolve o servidor/tópico que o backend usa em notify.py,
para a tela de Notificações mostrar o passo a passo (instalar o app ntfy,
assinar o tópico). `configured` indica se o tópico ainda é o placeholder.
"""
from fastapi import APIRouter, Depends

from .auth import current_user
from .config import settings

router = APIRouter(prefix="/api/notify", tags=["notify"])


def _configured(topic: str) -> bool:
    # o placeholder do .env.example contém "troque"; tópico curto é inseguro
    return "troque" not in topic.lower() and len(topic) >= 12


@router.get("/config")
def notify_config(_: str = Depends(current_user)):
    return {
        "server": settings.ntfy_server,
        "topic": settings.ntfy_topic,
        "app_public_url": settings.app_public_url,
        "configured": _configured(settings.ntfy_topic),
    }
