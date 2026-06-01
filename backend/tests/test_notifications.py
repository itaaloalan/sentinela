import httpx
import respx

from app import notifications, settings_store
from app.config import settings


def _ntfy_url() -> str:
    return f"{settings.ntfy_server}/{settings_store.ntfy_topic()}"


# ---- GET /config ----

def test_config_requires_auth(client):
    assert client.get("/api/notify/config").status_code == 401


def test_config_returns_ntfy_settings(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "ntfy_server", "https://ntfy.sh")
    monkeypatch.setattr(settings, "ntfy_topic", "sentinela-a7f3k9x2-portao")
    monkeypatch.setattr(settings, "app_public_url", "http://100.64.0.1:5173")
    body = client.get("/api/notify/config", headers=auth_headers).json()
    assert body == {
        "server": "https://ntfy.sh",
        "topic": "sentinela-a7f3k9x2-portao",  # sem row no banco → cai no .env
        "app_public_url": "http://100.64.0.1:5173",
        "configured": True,
    }


def test_configured_flags_placeholder_and_short_topics():
    assert notifications._configured("sentinela-a7f3k9x2-portao") is True
    assert notifications._configured("sentinela-troque-por-algo") is False  # placeholder
    assert notifications._configured("curto") is False  # < 12 chars


# ---- PUT /config (trocar o tópico) ----

def test_put_topic_requires_auth(client):
    assert client.put("/api/notify/config", json={"topic": "x" * 20}).status_code == 401


def test_put_topic_rejects_invalid(client, auth_headers):
    for bad in ["curto", "com espaco aqui xxxx", "tem/barra/invalida/xx"]:
        resp = client.put("/api/notify/config", json={"topic": bad}, headers=auth_headers)
        assert resp.status_code == 400


def test_put_topic_persists_and_overrides_env(client, auth_headers):
    novo = "sentinela-b8x2-novo-topico"
    resp = client.put("/api/notify/config", json={"topic": f"  {novo}  "}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["topic"] == novo  # trim aplicado
    # persistiu: GET reflete e settings_store retorna o novo
    assert client.get("/api/notify/config", headers=auth_headers).json()["topic"] == novo
    assert settings_store.ntfy_topic() == novo
    # PUT de novo atualiza a row existente (não duplica)
    outro = "sentinela-c9y3-outro-topico"
    client.put("/api/notify/config", json={"topic": outro}, headers=auth_headers)
    assert settings_store.ntfy_topic() == outro


# ---- POST /test (enviar pelo backend) ----

def test_send_test_requires_auth(client):
    assert client.post("/api/notify/test").status_code == 401


def test_send_test_success(client, auth_headers):
    with respx.mock:
        route = respx.put(_ntfy_url()).mock(return_value=httpx.Response(200))
        body = client.post("/api/notify/test", headers=auth_headers).json()
    assert route.called
    assert body["sent"] is True
    assert body["topic"] == settings_store.ntfy_topic()


def test_send_test_failure_returns_502(client, auth_headers):
    with respx.mock:
        respx.put(_ntfy_url()).mock(side_effect=httpx.ConnectError("sem rede"))
        resp = client.post("/api/notify/test", headers=auth_headers)
    assert resp.status_code == 502
    assert "ntfy" in resp.json()["detail"]
