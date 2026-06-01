import datetime as dt

from sqlmodel import Session

from app import database, summary
from app.db_models import Camera, Event


def _seed_camera(name: str = "portao") -> int:
    with Session(database.engine) as s:
        cam = Camera(name=name, source="rtsp://x", kind="rtsp")
        s.add(cam)
        s.commit()
        s.refresh(cam)
        return cam.id


def _add_event(camera_id: int, label: str, when: dt.datetime, model_id: int = 1):
    with Session(database.engine) as s:
        s.add(
            Event(
                model_id=model_id,
                camera_id=camera_id,
                label=label,
                snapshot="x.jpg",
                created_at=when,
            )
        )
        s.commit()


def test_today_requires_auth(client):
    assert client.get("/api/summary/today").status_code == 401


def test_today_empty(client, auth_headers, monkeypatch):
    monkeypatch.setattr(summary, "_today", lambda: dt.date(2026, 6, 1))
    body = client.get("/api/summary/today", headers=auth_headers).json()
    assert body["total"] == 0
    assert body["text"] == "Nenhum evento registrado hoje."
    assert body["by_camera"] == [] and body["first_at"] is None


def test_today_summarizes_events(client, auth_headers, monkeypatch):
    cam = _seed_camera("portao")
    day = dt.date(2026, 6, 1)
    monkeypatch.setattr(summary, "_today", lambda: day)
    base = dt.datetime(2026, 6, 1, 8, 0, tzinfo=dt.timezone.utc)
    _add_event(cam, "aberto", base)
    _add_event(cam, "aberto", base.replace(hour=8, minute=30))
    _add_event(cam, "fechado", base.replace(hour=17, minute=5))
    # evento de ontem não entra
    _add_event(cam, "aberto", base - dt.timedelta(days=1))
    body = client.get("/api/summary/today", headers=auth_headers).json()
    assert body["total"] == 3
    assert body["by_label"][0] == {"label": "aberto", "count": 2}
    assert body["by_camera"] == [{"camera": "portao", "count": 3}]
    assert body["busiest_hour"] == 8
    assert "08:00 e 17:05" in body["text"]
    assert "2× aberto" in body["text"]


def test_summarize_unknown_camera_id():
    day = dt.date(2026, 6, 1)
    ev = Event(
        model_id=1, camera_id=99, label="aberto", snapshot="x",
        created_at=dt.datetime(2026, 6, 1, 9, 0, tzinfo=dt.timezone.utc),
    )
    out = summary.summarize([ev], {}, day)
    assert out["by_camera"] == [{"camera": "câmera 99", "count": 1}]


def test_ask_no_events(client, auth_headers, monkeypatch):
    monkeypatch.setattr(summary, "_today", lambda: dt.date(2026, 6, 1))
    body = client.post("/api/summary/ask", json={"question": "quantos?"}, headers=auth_headers).json()
    assert body["answer"] == "Hoje ainda não houve nenhum evento."


def test_ask_intents(client, auth_headers, monkeypatch):
    cam = _seed_camera("portao")
    day = dt.date(2026, 6, 1)
    monkeypatch.setattr(summary, "_today", lambda: day)
    base = dt.datetime(2026, 6, 1, 8, 0, tzinfo=dt.timezone.utc)
    _add_event(cam, "aberto", base)
    _add_event(cam, "fechado", base.replace(hour=9))

    def ask(q: str) -> str:
        return client.post("/api/summary/ask", json={"question": q}, headers=auth_headers).json()["answer"]

    assert "às 08:00, 09:00" in ask("quando aconteceu?")
    assert ask("o que houve na portao?") == "A câmera 'portao' registrou 2 evento(s) hoje."
    assert ask("teve algo aberto?") == "Houve 1 evento(s) de 'aberto' hoje."
    assert ask("me conta tudo") == "Hoje houve 2 evento(s) no total."


def test_ask_requires_auth(client):
    assert client.post("/api/summary/ask", json={"question": "x"}).status_code == 401


def test_today_returns_date():
    assert isinstance(summary._today(), dt.date)
