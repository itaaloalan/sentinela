"""Registro de streams no go2rtc em runtime (Fase 2), best-effort.

Contrato REST verificado (AlexxIT/go2rtc, internal/streams/api.go):
  - adicionar/upsert: PUT  /api/streams?name=<name>&src=<source>
  - remover:          DELETE /api/streams?src=<name>
    ⚠️ no DELETE o parâmetro chama-se `src` mas recebe o **nome** do stream
    (a chave do mapa), não a URL da fonte.

Estas chamadas NUNCA derrubam o request do backend: se o go2rtc estiver fora do
ar, logamos um aviso e seguimos (o SQLite é a fonte da verdade; uma futura
reconciliação no startup pode re-registrar os streams).
"""
import logging

import httpx

from .config import settings

log = logging.getLogger("sentinela.go2rtc")


async def grab_frame(name: str, timeout: float = 10) -> bytes:
    """Pega um snapshot JPEG da câmera via go2rtc. Levanta httpx.HTTPError.

    `params` (e não f-string) p/ encodar nomes com espaço/acento corretamente.
    `timeout` curto em quem não pode esperar (ex.: página de saúde).
    """
    url = f"{settings.go2rtc_url}/api/frame.jpeg"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, params={"src": name})
    resp.raise_for_status()
    return resp.content


async def register_stream(name: str, source: str) -> bool:
    """PUT do stream no go2rtc. Retorna True em sucesso, False caso contrário."""
    url = f"{settings.go2rtc_url}/api/streams"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.put(url, params={"name": name, "src": source})
    except httpx.HTTPError as exc:
        log.warning("go2rtc indisponível ao registrar %s: %s", name, exc)
        return False
    if resp.status_code >= 400:
        log.warning(
            "go2rtc rejeitou o stream %s: %s %s", name, resp.status_code, resp.text
        )
        return False
    return True


async def unregister_stream(name: str) -> bool:
    """DELETE do stream no go2rtc. Retorna True em sucesso, False caso contrário."""
    url = f"{settings.go2rtc_url}/api/streams"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.delete(url, params={"src": name})
    except httpx.HTTPError as exc:
        log.warning("go2rtc indisponível ao remover %s: %s", name, exc)
        return False
    if resp.status_code >= 400:
        log.warning(
            "go2rtc falhou ao remover o stream %s: %s %s",
            name,
            resp.status_code,
            resp.text,
        )
        return False
    return True
