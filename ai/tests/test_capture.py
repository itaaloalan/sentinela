import httpx
import pytest
import respx

import capture


@respx.mock
def test_grab_frame_returns_jpeg_bytes():
    url = f"{capture.GO2RTC_URL}/api/frame.jpeg?src=portao"
    respx.get(url).mock(return_value=httpx.Response(200, content=b"\xff\xd8jpeg"))
    assert capture.grab_frame("portao") == b"\xff\xd8jpeg"


@respx.mock
def test_grab_frame_raises_on_http_error():
    url = f"{capture.GO2RTC_URL}/api/frame.jpeg?src=portao"
    respx.get(url).mock(return_value=httpx.Response(500))
    with pytest.raises(httpx.HTTPStatusError):
        capture.grab_frame("portao")


def test_save_frame_writes_file(tmp_path, monkeypatch):
    monkeypatch.setattr(capture, "DATA_DIR", tmp_path)
    path = capture.save_frame("portao", "aberto", b"jpegdata")
    assert path.exists()
    assert path.read_bytes() == b"jpegdata"
    assert path.parent == tmp_path / "portao" / "aberto"
