"""Status dos subsistemas (backend, go2rtc, IA) pra UI mostrar sempre.

- backend: se respondeu, está no ar (True).
- go2rtc: ping no /api/streams.
- ai: o monitor (processo separado) faz heartbeat aqui a cada ciclo; consideramos
  online se o último sinal foi há menos de _AI_FRESH_SECONDS.
"""
import time

import httpx
from fastapi import APIRouter, Depends

from . import settings_store
from .auth import current_user
from .config import settings

router = APIRouter(prefix="/api/status", tags=["status"])

_AI_FRESH_SECONDS = 30


def _now() -> float:
    return time.time()


async def _go2rtc_ok() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{settings.go2rtc_url}/api/streams")
        return resp.status_code < 400
    except httpx.HTTPError:
        return False


def _ai_ok() -> bool:
    raw = settings_store.ai_heartbeat()
    if not raw:
        return False
    return _now() - float(raw) < _AI_FRESH_SECONDS


@router.get("")
async def status(_: str = Depends(current_user)):
    return {"backend": True, "go2rtc": await _go2rtc_ok(), "ai": _ai_ok()}


@router.post("/heartbeat")
def heartbeat(_: str = Depends(current_user)):
    """O monitor de IA chama isto a cada ciclo pra sinalizar que está vivo."""
    settings_store.set_ai_heartbeat(str(_now()))
    return {"ok": True}
