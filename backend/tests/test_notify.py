import httpx
import respx

from app import settings_store
from app.config import settings
from app.notify import send_emergency, send_gate_open

NTFY_URL = f"{settings.ntfy_server}/{settings.ntfy_topic}"
DISCORD = "https://discord.com/api/webhooks/1/abc"


@respx.mock
async def test_send_emergency_high_priority():
    route = respx.put(NTFY_URL).mock(return_value=httpx.Response(200))
    await send_emergency()
    assert route.called
    assert route.calls.last.request.headers["Priority"] == "urgent"


@respx.mock
async def test_send_gate_open_without_event_id():
    route = respx.put(NTFY_URL).mock(return_value=httpx.Response(200))
    await send_gate_open(b"jpegbytes")
    assert route.called
    sent = route.calls.last.request
    assert sent.headers["Click"] == settings.app_public_url
    assert sent.content == b"jpegbytes"


@respx.mock
async def test_send_gate_open_with_event_id():
    route = respx.put(NTFY_URL).mock(return_value=httpx.Response(200))
    await send_gate_open(b"jpegbytes", event_id=42)
    assert route.called
    assert route.calls.last.request.headers["Click"] == (
        f"{settings.app_public_url}/events/42"
    )


@respx.mock
async def test_send_gate_open_posts_image_to_discord():
    settings_store.set_discord_webhook(DISCORD)
    respx.put(NTFY_URL).mock(return_value=httpx.Response(200))
    discord = respx.post(DISCORD).mock(return_value=httpx.Response(204))
    await send_gate_open(b"jpegbytes")
    assert discord.called
    assert b"jpegbytes" in discord.calls.last.request.content  # multipart com a imagem


@respx.mock
async def test_send_gate_open_swallows_discord_failure():
    settings_store.set_discord_webhook(DISCORD)
    respx.put(NTFY_URL).mock(return_value=httpx.Response(200))
    respx.post(DISCORD).mock(side_effect=httpx.ConnectError("discord fora"))
    await send_gate_open(b"jpegbytes")  # não levanta — Discord é best-effort
