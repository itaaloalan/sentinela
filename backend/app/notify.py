"""Notificação via ntfy (snapshot inline no iPhone).

Disparado quando um modelo ativo detecta "portão aberto" (após debounce).
"""
import httpx

from . import settings_store
from .config import settings


def _topic_url() -> str:
    return f"{settings.ntfy_server}/{settings_store.ntfy_topic()}"


async def _send_discord(client: httpx.Client, content: str, jpeg: bytes | None = None) -> None:
    """Posta no webhook do Discord, se configurado. Best-effort no caminho do alerta."""
    url = settings_store.discord_webhook()
    if not url:
        return
    if jpeg is None:
        resp = await client.post(url, json={"content": content})
    else:
        resp = await client.post(
            url, data={"content": content}, files={"file": ("portao.jpg", jpeg, "image/jpeg")}
        )
    resp.raise_for_status()


async def send_test() -> None:
    """Dispara uma notificação de teste no ntfy + Discord (se configurado)."""
    headers = {
        "Title": "Sentinela: teste",
        "Tags": "white_check_mark",
        "Click": settings.app_public_url,
    }
    msg = b"Notificacao de teste do Sentinela. Se chegou, esta tudo certo!"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.put(_topic_url(), content=msg, headers=headers)
        resp.raise_for_status()
        await _send_discord(client, "✅ Sentinela: notificação de teste. Tudo certo!")


async def send_emergency() -> None:
    """Botão de emergência: alerta urgente no ntfy + Discord."""
    headers = {
        "Title": "EMERGENCIA - Sentinela",
        "Priority": "urgent",
        "Tags": "rotating_light,sos",
        "Click": settings.app_public_url,
    }
    msg = b"BOTAO DE EMERGENCIA acionado no Sentinela!"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.put(_topic_url(), content=msg, headers=headers)
        resp.raise_for_status()
        await _send_discord(client, "🆘 EMERGÊNCIA acionada no Sentinela!")


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
        try:
            await _send_discord(client, "🚨 Portão aberto!", snapshot_jpeg)
        except httpx.HTTPError:
            pass  # Discord é canal extra; não derruba o alerta principal (ntfy)
