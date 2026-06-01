import httpx
import respx

from app.config import settings
from app.notify import send_gate_open

NTFY_URL = f"{settings.ntfy_server}/{settings.ntfy_topic}"


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
