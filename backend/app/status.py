"""Status e saúde dos subsistemas (backend, go2rtc, IA) + dashboard.

- `/api/status`: pílula leve sempre visível (backend/go2rtc/IA up?).
- `/api/status/health`: visão de saúde/dashboard — eventos do dia, disco,
  temperatura, câmeras online/offline e logs por serviço ("o que está
  acontecendo"). O monitor de IA faz heartbeat aqui a cada ciclo.
"""
import datetime as dt
import io
import shutil
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from . import applog, settings_store
from .auth import current_user
from .config import settings
from .database import get_session
from .db_models import Camera, Event
from .go2rtc import grab_frame

router = APIRouter(prefix="/api/status", tags=["status"])

_AI_FRESH_SECONDS = 30
_TEMP_PATH = "/sys/class/thermal/thermal_zone0/temp"


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


async def _go2rtc_streams() -> dict | None:
    """Streams do go2rtc; None se inacessível (distingue 'fora' de 'sem streams')."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{settings.go2rtc_url}/api/streams")
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError:
        return None


async def _go2rtc_log() -> list[str]:
    """Últimas linhas do log do go2rtc (endpoint /api/log)."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{settings.go2rtc_url}/api/log")
        resp.raise_for_status()
    except httpx.HTTPError:
        return []
    return resp.text.splitlines()[-100:]


def _disk() -> dict | None:
    """Uso do disco no diretório de dados; None se o caminho não existir."""
    try:
        usage = shutil.disk_usage(settings.ai_data_dir)
    except OSError:
        return None
    percent = round(usage.used / usage.total * 100, 1) if usage.total else 0.0
    return {"total": usage.total, "used": usage.used, "free": usage.free, "percent": percent}


def _cpu_temp() -> float | None:
    """Temperatura da CPU (°C) via thermal_zone0 do Linux; None se indisponível."""
    try:
        with open(_TEMP_PATH) as fh:
            return round(int(fh.read().strip()) / 1000, 1)
    except (OSError, ValueError):
        return None


def _events_today(session: Session) -> int:
    start = dt.datetime.now(dt.timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return len(session.exec(select(Event).where(Event.created_at >= start)).all())


def analyze_frame(jpeg: bytes) -> dict:
    """Brilho e nível de detalhe do frame → flag de câmera obstruída/coberta.

    Coberta/tapada deixa a imagem muito escura (brilho baixo) ou muito uniforme
    (desvio-padrão baixo, sem textura). Limiares conservadores p/ evitar alarme.
    """
    from PIL import Image, ImageStat  # lazy

    img = Image.open(io.BytesIO(jpeg)).convert("L")
    stat = ImageStat.Stat(img)
    brightness, detail = stat.mean[0], stat.stddev[0]
    return {
        "brightness": round(brightness, 1),
        "detail": round(detail, 1),
        "obstructed": brightness < 15 or detail < 8,
    }


async def _camera_status(streams: dict, session: Session) -> list[dict]:
    """Cada câmera + online (produtor no go2rtc) + obstrução (análise do frame)."""
    out = []
    for cam in session.exec(select(Camera)).all():
        info = streams.get(cam.name)
        online = bool(info and info.get("producers"))
        entry = {"name": cam.name, "online": online, "obstructed": None, "brightness": None}
        if online:
            try:
                jpeg = await grab_frame(cam.name)
                if jpeg:
                    a = analyze_frame(jpeg)
                    entry["obstructed"] = a["obstructed"]
                    entry["brightness"] = a["brightness"]
            except (httpx.HTTPError, OSError):
                pass  # frame indisponível/ilegível → deixa obstrução indeterminada
        out.append(entry)
    return out


async def _internet_ok() -> bool:
    """Há internet? (consulta best-effort a um host externo)."""
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.get("https://api.ipify.org")
        return resp.status_code < 500
    except httpx.HTTPError:
        return False


def _storage_ok() -> bool:
    """Dá pra gravar snapshots/eventos? (escreve um arquivo de teste no dir de dados)."""
    try:
        d = Path(settings.ai_data_dir)
        d.mkdir(parents=True, exist_ok=True)
        probe = d / ".write_probe"
        probe.write_text("ok")
        probe.unlink()
        return True
    except OSError:
        return False


@router.get("")
async def status(_: str = Depends(current_user)):
    return {"backend": True, "go2rtc": await _go2rtc_ok(), "ai": _ai_ok()}


@router.get("/overview")
async def overview(
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Resumo leve p/ o painel/visão geral (sem puxar frames — rápido)."""
    streams = await _go2rtc_streams() or {}
    cameras = [
        {"name": cam.name, "online": bool(streams.get(cam.name, {}).get("producers"))}
        for cam in session.exec(select(Camera)).all()
    ]
    disk = _disk()
    return {
        "cameras": cameras,
        "events_today": _events_today(session),
        "disk_percent": disk["percent"] if disk else None,
    }


@router.get("/health")
async def health(
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    raw = settings_store.ai_heartbeat()
    last_seen = (_now() - float(raw)) if raw else None
    streams = await _go2rtc_streams()
    return {
        "events_today": _events_today(session),
        "disk": _disk(),
        "temperature_c": _cpu_temp(),
        "internet": await _internet_ok(),
        "storage_ok": _storage_ok(),
        "cameras": await _camera_status(streams or {}, session),
        "go2rtc": {"reachable": streams is not None, "log": await _go2rtc_log()},
        "ai": {"online": _ai_ok(), "last_seen_seconds": last_seen},
        "backend": {"log": applog.recent()},
    }


@router.post("/heartbeat")
def heartbeat(_: str = Depends(current_user)):
    """O monitor de IA chama isto a cada ciclo pra sinalizar que está vivo."""
    settings_store.set_ai_heartbeat(str(_now()))
    return {"ok": True}
