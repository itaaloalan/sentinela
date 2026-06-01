import subprocess

import httpx
import respx

from app import access


def test_access_requires_auth(client):
    assert client.get("/api/access").status_code == 401


def test_access_returns_creds_and_urls(client, auth_headers, monkeypatch):
    monkeypatch.setattr(access, "tailscale_ip", lambda: "100.64.0.5")

    async def fake_public():
        return "203.0.113.7"

    monkeypatch.setattr(access, "public_ip", fake_public)
    body = client.get("/api/access", headers=auth_headers).json()
    assert body["username"] == "admin"
    assert body["password"] == "secret"
    assert body["local_url"] == "http://localhost:5173"
    assert body["tailscale_url"] == "http://100.64.0.5:5173"
    assert body["public_url"] == "http://203.0.113.7:5173"


def test_access_when_tailscale_and_public_absent(client, auth_headers, monkeypatch):
    monkeypatch.setattr(access, "tailscale_ip", lambda: None)

    async def fake_public():
        return None

    monkeypatch.setattr(access, "public_ip", fake_public)
    body = client.get("/api/access", headers=auth_headers).json()
    assert body["tailscale_url"] is None
    assert body["public_url"] is None


def test_url_for_without_port(monkeypatch):
    monkeypatch.setattr(access.settings, "app_public_url", "https://sentinela.exemplo")
    assert access._url_for("100.64.0.5") == "https://100.64.0.5"


def test_tailscale_ip_not_installed(monkeypatch):
    monkeypatch.setattr(access.shutil, "which", lambda _: None)
    assert access.tailscale_ip() is None


def test_tailscale_ip_reads_first_line(monkeypatch):
    monkeypatch.setattr(access.shutil, "which", lambda _: "/usr/bin/tailscale")

    def fake_run(*a, **k):
        return subprocess.CompletedProcess(a, 0, stdout="100.64.0.5\nfd7a::1\n", stderr="")

    monkeypatch.setattr(access.subprocess, "run", fake_run)
    assert access.tailscale_ip() == "100.64.0.5"


def test_tailscale_ip_empty_output(monkeypatch):
    monkeypatch.setattr(access.shutil, "which", lambda _: "/usr/bin/tailscale")
    monkeypatch.setattr(
        access.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout="  \n", stderr="")
    )
    assert access.tailscale_ip() is None


def test_tailscale_ip_subprocess_error(monkeypatch):
    monkeypatch.setattr(access.shutil, "which", lambda _: "/usr/bin/tailscale")

    def boom(*a, **k):
        raise OSError("falhou")

    monkeypatch.setattr(access.subprocess, "run", boom)
    assert access.tailscale_ip() is None


async def test_public_ip_success():
    with respx.mock:
        respx.get("https://api.ipify.org").mock(return_value=httpx.Response(200, text="203.0.113.7"))
        assert await access.public_ip() == "203.0.113.7"


async def test_public_ip_empty():
    with respx.mock:
        respx.get("https://api.ipify.org").mock(return_value=httpx.Response(200, text="  "))
        assert await access.public_ip() is None


async def test_public_ip_offline():
    with respx.mock:
        respx.get("https://api.ipify.org").mock(side_effect=httpx.ConnectError("fora"))
        assert await access.public_ip() is None
