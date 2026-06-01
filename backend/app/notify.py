"""Notificação via ntfy (snapshot inline no iPhone).

Disparado quando um modelo ativo detecta "portão aberto" (após debounce).
"""
import httpx

from . import settings_store
from .config import settings


def _topic_url() -> str:
    return f"{settings.ntfy_server}/{settings_store.ntfy_topic()}"


async def send_test() -> None:
    """Dispara uma notificação de teste no tópico atual (botão na UI)."""
    headers = {
        "Title": "Sentinela: teste",
        "Tags": "white_check_mark",
        "Click": settings.app_public_url,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.put(
            _topic_url(),
            content=b"Notificacao de teste do Sentinela. Se chegou, esta tudo certo!",
            headers=headers,
        )
    resp.raise_for_status()


async def send_gate_open(snapshot_jpeg: bytes, event_id: int | None = None) -> None:
    """Publica no ntfy com o snapshot no corpo (renderiza inline na notificação)."""
    click = settings.app_public_url
    if event_id is not None:
        click = f"{settings.app_public_url}/events/{event_id}"

    url = _topic_url()
    headers = {
        # Cabeçalhos HTTP só aceitam ASCII (latin-1); sem acento no título.
        "Title": "Portao aberto!",
        "Priority": "high",
        "Tags": "rotating_light",
        "Filename": "portao.jpg",
        "Click": click,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        await client.put(url, content=snapshot_jpeg, headers=headers)


# Fallback opcional (Telegram) — implementar se desejado:
# async def send_telegram(...): ...
