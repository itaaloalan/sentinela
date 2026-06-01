import httpx
import respx
from sqlmodel import Session

from app import database
from app.config import settings
from app.db_models import AIModel

NTFY_URL = f"{settings.ntfy_server}/{settings.ntfy_topic}"


def _make_model() -> int:
    with Session(database.engine) as s:
        rec = AIModel(camera_id=3, name="portao", classes_csv="aberto,fechado")
        s.add(rec)
        s.commit()
        s.refresh(rec)
        return rec.id


def _post_event(client, auth_headers, model_id, *, ntfy_status=200, ntfy_error=False):
    with respx.mock(assert_all_mocked=False, assert_all_called=False) as router:
        route = router.put(NTFY_URL)
        if ntfy_error:
            route.mock(side_effect=httpx.ConnectError("sem rede"))
        else:
            route.mock(return_value=httpx.Response(ntfy_status))
        return client.post(
            "/api/events",
            data={"model_id": model_id, "label": "aberto"},
            files={"file": ("snap.jpg", b"\xff\xd8jpeg", "image/jpeg")},
            headers=auth_headers,
        )


def test_create_event_fires_ntfy(client, auth_headers):
    mid = _make_model()
    resp = _post_event(client, auth_headers, mid)
    assert resp.status_code == 201
    body = resp.json()
    assert body["label"] == "aberto"
    assert body["camera_id"] == 3
    assert body["snapshot"].endswith(".jpg")


def test_create_event_survives_ntfy_failure(client, auth_headers):
    mid = _make_model()
    resp = _post_event(client, auth_headers, mid, ntfy_error=True)
    assert resp.status_code == 201  # evento salvo mesmo com ntfy fora


def test_create_event_model_not_found(client, auth_headers):
    resp = client.post(
        "/api/events",
        data={"model_id": 9999, "label": "aberto"},
        files={"file": ("snap.jpg", b"x", "image/jpeg")},
        headers=auth_headers,
    )
    assert resp.status_code == 404


def test_list_events(client, auth_headers):
    mid = _make_model()
    _post_event(client, auth_headers, mid)
    _post_event(client, auth_headers, mid)
    events = client.get("/api/events", headers=auth_headers).json()
    assert len(events) == 2


def test_event_snapshot_served(client, auth_headers):
    mid = _make_model()
    eid = _post_event(client, auth_headers, mid).json()["id"]
    resp = client.get(f"/api/events/{eid}/snapshot", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.content == b"\xff\xd8jpeg"


def test_event_snapshot_not_found(client, auth_headers):
    assert (
        client.get("/api/events/9999/snapshot", headers=auth_headers).status_code == 404
    )


def test_event_snapshot_file_missing(client, auth_headers, monkeypatch):
    import shutil

    mid = _make_model()
    eid = _post_event(client, auth_headers, mid).json()["id"]
    # remove o arquivo em disco, mas mantém o registro
    shutil.rmtree(f"{settings.ai_data_dir}/events", ignore_errors=True)
    assert (
        client.get(f"/api/events/{eid}/snapshot", headers=auth_headers).status_code == 404
    )
