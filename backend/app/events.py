"""Eventos do monitor (ex.: portão aberto) + disparo do alerta ntfy (Fase 5).

O monitor (serviço ai/) faz POST aqui com o snapshot quando detecta o evento;
salvamos o snapshot em disco, persistimos no SQLite e disparamos o ntfy.
"""
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from .auth import current_user, media_user
from .config import settings
from .database import get_session
from .db_models import AIModel, Event
from .notify import send_gate_open

router = APIRouter(prefix="/api/events", tags=["events"])


def _events_dir() -> Path:
    return Path(settings.ai_data_dir) / "events"


def _save_snapshot(jpeg: bytes) -> str:
    out = _events_dir()
    out.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    (out / filename).write_bytes(jpeg)
    return filename


def _serialize(ev: Event) -> dict:
    return {
        "id": ev.id,
        "model_id": ev.model_id,
        "camera_id": ev.camera_id,
        "label": ev.label,
        "snapshot": ev.snapshot,
        "created_at": ev.created_at.isoformat(),
    }


@router.post("", status_code=201)
async def create_event(
    model_id: int = Form(...),
    label: str = Form(...),
    file: UploadFile = File(...),
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    model = session.get(AIModel, model_id)
    if model is None:
        raise HTTPException(404, "Modelo não encontrado")
    jpeg = await file.read()
    ev = Event(
        model_id=model_id,
        camera_id=model.camera_id,
        label=label,
        snapshot=_save_snapshot(jpeg),
    )
    session.add(ev)
    session.commit()
    session.refresh(ev)
    try:
        await send_gate_open(jpeg, ev.id)
    except httpx.HTTPError:
        pass  # alerta é best-effort; o evento já foi salvo
    return _serialize(ev)


@router.get("")
def list_events(
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    events = session.exec(select(Event).order_by(Event.created_at.desc())).all()
    return [_serialize(e) for e in events]


@router.get("/{eid}/snapshot")
def event_snapshot(
    eid: int,
    _: str = Depends(media_user),
    session: Session = Depends(get_session),
):
    ev = session.get(Event, eid)
    if ev is None:
        raise HTTPException(404, "Evento não encontrado")
    path = _events_dir() / ev.snapshot
    if not path.is_file():
        raise HTTPException(404, "Snapshot não encontrado")
    return FileResponse(path, media_type="image/jpeg")
