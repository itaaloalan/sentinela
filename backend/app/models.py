"""API de modelos de IA / treino do portão (ver docs/AI-GATE.md).

Estágio 1: modelos persistidos no SQLite + captura/rotulagem de frames ao vivo
(via go2rtc) gravados em disco (frames.py) + crop. Treino/inferência reais
chegam no Estágio 2 (ai/trainer.py / monitor.py); aqui ficam como stub.
"""
import json

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import frames, inference, training
from .auth import current_user, media_user
from .config import settings
from .database import get_session
from .db_models import AIModel, Camera
from .go2rtc import grab_frame

router = APIRouter(prefix="/api/models", tags=["models"])


class ModelIn(BaseModel):
    camera_id: int
    name: str = "portao"
    classes: list[str] = ["aberto", "fechado"]
    alert_label: str | None = None  # qual classe dispara o alerta (default: 1ª)


class ModelPatch(BaseModel):
    name: str | None = None
    alert_label: str | None = None
    debounce_seconds: int | None = Field(default=None, ge=0, le=3600)


class Crop(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int


def _classes(rec: AIModel) -> list[str]:
    return rec.classes_csv.split(",")


def _serialize(rec: AIModel) -> dict:
    classes = _classes(rec)
    return {
        "id": rec.id,
        "camera_id": rec.camera_id,
        "name": rec.name,
        "classes": classes,
        "alert_label": rec.alert_label or classes[0],
        "debounce_seconds": rec.debounce_seconds
        if rec.debounce_seconds is not None
        else settings.ai_open_debounce_seconds,
        "crop": json.loads(rec.crop_json) if rec.crop_json else None,
        "version": rec.version,
        "accuracy": rec.accuracy,
        "active": rec.active,
        "status": rec.status,
        "frames": {label: frames.count_frames(rec.id, label) for label in classes},
    }


def _get(session: Session, mid: int) -> AIModel:
    rec = session.get(AIModel, mid)
    if rec is None:
        raise HTTPException(404, "Modelo não encontrado")
    return rec


@router.post("", status_code=201)
def create_model(
    m: ModelIn,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    alert_label = m.alert_label if m.alert_label in m.classes else m.classes[0]
    rec = AIModel(
        camera_id=m.camera_id,
        name=m.name,
        classes_csv=",".join(m.classes),
        alert_label=alert_label,
    )
    session.add(rec)
    session.commit()
    session.refresh(rec)
    return _serialize(rec)


@router.get("")
def list_models(
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    return [_serialize(rec) for rec in session.exec(select(AIModel)).all()]


@router.post("/{mid}/capture")
async def capture_frame(
    mid: int,
    label: str = Query(...),
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Captura um frame ao vivo da câmera do modelo e o rotula."""
    rec = _get(session, mid)
    classes = _classes(rec)
    if label not in classes:
        raise HTTPException(400, f"label deve ser uma de {classes}")
    cam = session.get(Camera, rec.camera_id)
    if cam is None:
        raise HTTPException(400, "Câmera do modelo não encontrada")
    try:
        jpeg = await grab_frame(cam.name)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"go2rtc indisponível: {e}")
    frames.save_frame(rec.id, label, jpeg)
    return {"label": label, "frames": frames.count_frames(rec.id, label)}


@router.get("/{mid}/frames")
def list_model_frames(
    mid: int,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    rec = _get(session, mid)
    return {label: frames.list_frames(rec.id, label) for label in _classes(rec)}


@router.get("/{mid}/frames/{label}/{filename}")
def get_frame_image(
    mid: int,
    label: str,
    filename: str,
    _: str = Depends(media_user),
    session: Session = Depends(get_session),
):
    _get(session, mid)
    path = frames.frame_path(mid, label, filename)
    if path is None:
        raise HTTPException(404, "Frame não encontrado")
    return FileResponse(path, media_type="image/jpeg")


@router.delete("/{mid}/frames/{label}/{filename}", status_code=204)
def delete_model_frame(
    mid: int,
    label: str,
    filename: str,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    _get(session, mid)
    frames.delete_frame(mid, label, filename)
    return Response(status_code=204)


@router.put("/{mid}")
def update_model(
    mid: int,
    patch: ModelPatch,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Edita nome e/ou a configuração de alerta (label que dispara + tempo)."""
    rec = _get(session, mid)
    if patch.name is not None:
        name = patch.name.strip()
        if not name:
            raise HTTPException(400, "nome não pode ser vazio")
        rec.name = name
    if patch.alert_label is not None:
        if patch.alert_label not in _classes(rec):
            raise HTTPException(400, f"alert_label deve ser uma de {_classes(rec)}")
        rec.alert_label = patch.alert_label
    if patch.debounce_seconds is not None:
        rec.debounce_seconds = patch.debounce_seconds
    session.add(rec)
    session.commit()
    session.refresh(rec)
    return _serialize(rec)


@router.put("/{mid}/crop")
def set_crop(
    mid: int,
    crop: Crop,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    rec = _get(session, mid)
    rec.crop_json = json.dumps(crop.model_dump())
    session.add(rec)
    session.commit()
    session.refresh(rec)
    return _serialize(rec)


@router.post("/{mid}/train")
def train(
    mid: int,
    background: BackgroundTasks,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    rec = _get(session, mid)
    rec.status = "treinando"
    session.add(rec)
    session.commit()
    background.add_task(training.run_training, mid)
    return {"ok": True, "status": "treinando"}


@router.get("/{mid}/status")
def status(
    mid: int,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    rec = _get(session, mid)
    return {"status": rec.status, "accuracy": rec.accuracy, "version": rec.version}


@router.post("/{mid}/test")
async def test(
    mid: int,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Classifica um frame ao vivo com o modelo treinado (label + confiança)."""
    rec = _get(session, mid)
    cam = session.get(Camera, rec.camera_id)
    if cam is None:
        raise HTTPException(400, "Câmera do modelo não encontrada")
    crop = json.loads(rec.crop_json) if rec.crop_json else None
    try:
        return await inference.classify_live(rec, cam, crop)
    except (RuntimeError, ImportError) as e:
        raise HTTPException(501, str(e))  # não treinado / ultralytics ausente
    except httpx.HTTPError as e:
        raise HTTPException(502, f"go2rtc indisponível: {e}")


@router.post("/{mid}/activate")
def activate(
    mid: int,
    active: bool = True,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    rec = _get(session, mid)
    rec.active = active
    session.add(rec)
    session.commit()
    return {"id": mid, "active": rec.active}
