from app import notifications
from app.config import settings


def test_config_requires_auth(client):
    assert client.get("/api/notify/config").status_code == 401


def test_config_returns_ntfy_settings(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "ntfy_server", "https://ntfy.sh")
    monkeypatch.setattr(settings, "ntfy_topic", "sentinela-a7f3k9x2-portao")
    monkeypatch.setattr(settings, "app_public_url", "http://100.64.0.1:5173")
    body = client.get("/api/notify/config", headers=auth_headers).json()
    assert body == {
        "server": "https://ntfy.sh",
        "topic": "sentinela-a7f3k9x2-portao",
        "app_public_url": "http://100.64.0.1:5173",
        "configured": True,
    }


def test_configured_flags_placeholder_and_short_topics():
    assert notifications._configured("sentinela-a7f3k9x2-portao") is True
    assert notifications._configured("sentinela-troque-por-algo") is False  # placeholder
    assert notifications._configured("curto") is False  # < 12 chars
