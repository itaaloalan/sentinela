"""Notificação via ntfy (snapshot inline no iPhone).

Disparado quando um modelo ativo detecta "portão aberto" (após debounce).
"""
import httpx

from .config import settings


async def send_gate_open(snapshot_jpeg: bytes, event_id: int | None = None) -> None:
    """Publica no ntfy com o snapshot no corpo (renderiza inline na notificação)."""
    click = settings.app_public_url
    if event_id is not None:
        click = f"{settings.app_public_url}/events/{event_id}"

    url = f"{settings.ntfy_server}/{settings.ntfy_topic}"
    headers = {
        "Title": "Portão aberto!",
        "Priority": "high",
        "Tags": "rotating_light",
        "Filename": "portao.jpg",
        "Click": click,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        await client.put(url, content=snapshot_jpeg, headers=headers)


# Fallback opcional (Telegram) — implementar se desejado:
# async def send_telegram(...): ...
