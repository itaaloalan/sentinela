"""Endereços de acesso remoto (Tailscale / IP público) + credenciais.

Pra compartilhar o acesso ao Sentinela rapidamente: a UI mostra a URL pela
Tailscale e/ou pelo IP público, com as credenciais. Endpoint protegido — só
quem já está logado vê.

A senha em claro vem do `.env` (`settings.admin_pass`): é a credencial efetiva,
já que não há troca de senha na app (o hash no banco é derivado dela no boot).
"""
import shutil
import subprocess
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends

from .auth import current_user
from .config import settings

router = APIRouter(prefix="/api/access", tags=["access"])


def _url_for(host: str) -> str:
    """Monta a URL de acesso trocando o host do app_public_url pelo IP dado."""
    parsed = urlparse(settings.app_public_url)
    scheme = parsed.scheme or "http"
    netloc = host if parsed.port is None else f"{host}:{parsed.port}"
    return f"{scheme}://{netloc}"


def tailscale_ip() -> str | None:
    """IP 100.x da Tailscale via CLI; None se a Tailscale não estiver instalada/ativa."""
    exe = shutil.which("tailscale")
    if exe is None:
        return None
    try:
        out = subprocess.run(
            [exe, "ip", "-4"], capture_output=True, text=True, timeout=3
        )
    except (OSError, subprocess.SubprocessError):
        return None
    lines = out.stdout.strip().splitlines()
    return lines[0].strip() if lines else None


async def public_ip() -> str | None:
    """IP público (best-effort) consultando um serviço externo; None se offline."""
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.get("https://api.ipify.org")
        resp.raise_for_status()
    except httpx.HTTPError:
        return None
    return resp.text.strip() or None


@router.get("")
async def access(_: str = Depends(current_user)):
    ts = tailscale_ip()
    pub = await public_ip()
    return {
        "username": settings.admin_user,
        "password": settings.admin_pass,
        "local_url": settings.app_public_url,
        "tailscale_url": _url_for(ts) if ts else None,
        "public_url": _url_for(pub) if pub else None,
    }
