import httpx
import respx

from app.config import settings
from app.go2rtc import register_stream, unregister_stream

STREAMS_URL = f"{settings.go2rtc_url}/api/streams"


@respx.mock
async def test_register_ok():
    route = respx.put(STREAMS_URL).mock(return_value=httpx.Response(200))
    assert await register_stream("portao", "rtsp://x/y") is True
    assert route.called


@respx.mock
async def test_register_rejected_4xx():
    respx.put(STREAMS_URL).mock(return_value=httpx.Response(400, text="bad source"))
    assert await register_stream("portao", "rtsp://x/y") is False


@respx.mock
async def test_register_go2rtc_down():
    respx.put(STREAMS_URL).mock(side_effect=httpx.ConnectError("recusado"))
    assert await register_stream("portao", "rtsp://x/y") is False


@respx.mock
async def test_unregister_ok():
    route = respx.delete(STREAMS_URL).mock(return_value=httpx.Response(200))
    assert await unregister_stream("portao") is True
    assert route.called


@respx.mock
async def test_unregister_4xx():
    respx.delete(STREAMS_URL).mock(return_value=httpx.Response(500, text="erro"))
    assert await unregister_stream("portao") is False


@respx.mock
async def test_unregister_go2rtc_down():
    respx.delete(STREAMS_URL).mock(side_effect=httpx.ConnectError("recusado"))
    assert await unregister_stream("portao") is False
