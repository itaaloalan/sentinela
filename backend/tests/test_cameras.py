import httpx
import respx

from app import cameras as cameras_module
from app.config import settings

STREAMS_URL = f"{settings.go2rtc_url}/api/streams"
FRAME_URL = f"{settings.go2rtc_url}/api/frame.jpeg"

CAM = {
    "name": "portao",
    "source": "rtsp://127.0.0.1:8554/onvif2",
    "kind": "rtsp",
    "ptz_enabled": False,
}


def _create(client, headers, cam=CAM):
    """Cria uma câmera com o go2rtc mockado (PUT 200); devolve o JSON."""
    # assert_all_called=False: no caminho de nome duplicado o register_stream
    # nem chega a ser chamado (o 409 acontece antes).
    with respx.mock(assert_all_mocked=False, assert_all_called=False) as router:
        router.put(STREAMS_URL).mock(return_value=httpx.Response(200))
        resp = client.post("/api/cameras", json=cam, headers=headers)
    return resp


def test_list_empty(client, auth_headers):
    resp = client.get("/api/cameras", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_camera(client, auth_headers):
    resp = _create(client, auth_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] > 0
    assert body["name"] == "portao"
    assert body["source"] == CAM["source"]
    # persiste e aparece na listagem
    listed = client.get("/api/cameras", headers=auth_headers).json()
    assert [c["name"] for c in listed] == ["portao"]


def test_create_duplicate_name_returns_409(client, auth_headers):
    assert _create(client, auth_headers).status_code == 201
    assert _create(client, auth_headers).status_code == 409


def test_create_succeeds_even_if_go2rtc_down(client, auth_headers):
    with respx.mock(assert_all_mocked=False) as router:
        router.put(STREAMS_URL).mock(side_effect=httpx.ConnectError("recusado"))
        resp = client.post("/api/cameras", json=CAM, headers=auth_headers)
    assert resp.status_code == 201
    # mesmo com go2rtc fora, a câmera foi persistida
    assert len(client.get("/api/cameras", headers=auth_headers).json()) == 1


def test_delete_camera(client, auth_headers):
    cid = _create(client, auth_headers).json()["id"]
    with respx.mock(assert_all_mocked=False) as router:
        router.delete(STREAMS_URL).mock(return_value=httpx.Response(200))
        resp = client.delete(f"/api/cameras/{cid}", headers=auth_headers)
    assert resp.status_code == 204
    assert client.get("/api/cameras", headers=auth_headers).json() == []


def test_delete_nonexistent_is_noop(client, auth_headers):
    # Câmera inexistente: 204 sem chamar o go2rtc.
    resp = client.delete("/api/cameras/9999", headers=auth_headers)
    assert resp.status_code == 204


def test_snapshot_ok(client, auth_headers):
    cid = _create(client, auth_headers).json()["id"]
    with respx.mock(assert_all_mocked=False) as router:
        router.get(FRAME_URL).mock(
            return_value=httpx.Response(200, content=b"\xff\xd8jpegbytes")
        )
        resp = client.get(f"/api/cameras/{cid}/snapshot", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.content == b"\xff\xd8jpegbytes"


def test_snapshot_camera_not_found(client, auth_headers):
    resp = client.get("/api/cameras/9999/snapshot", headers=auth_headers)
    assert resp.status_code == 404


def test_snapshot_go2rtc_unavailable_returns_502(client, auth_headers):
    cid = _create(client, auth_headers).json()["id"]
    with respx.mock(assert_all_mocked=False) as router:
        router.get(FRAME_URL).mock(side_effect=httpx.ConnectError("recusado"))
        resp = client.get(f"/api/cameras/{cid}/snapshot", headers=auth_headers)
    assert resp.status_code == 502


def test_discover_requires_auth(client):
    assert client.get("/api/cameras/discover").status_code == 401


def test_discover_returns_candidates(client, auth_headers, monkeypatch):
    fake = {
        "subnet": "192.168.0.0/24",
        "candidates": [
            {
                "ip": "192.168.0.12", "mac": None, "vendor": None, "ports": [554],
                "kind": "rtsp", "suggested_source": "rtsp://admin:SENHA@192.168.0.12:554/onvif1",
                "label": "RTSP",
            }
        ],
    }

    async def fake_discover():
        return fake

    monkeypatch.setattr(cameras_module.discovery, "discover", fake_discover)
    resp = client.get("/api/cameras/discover", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == fake
