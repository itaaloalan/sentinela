"""Modo Vigilante: observações contínuas geradas pela IA.

O monitor (serviço ai/) descreve frames e faz POST aqui; guardamos a descrição
(e o snapshot, opcional) no SQLite. A UI lista e liga/desliga o modo.
"""
import io
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from . import settings_store
from .auth import current_user, media_user
from .config import settings
from .database import get_session
from .db_models import Camera, Observation
from .go2rtc import grab_frame

router = APIRouter(prefix="/api/observations", tags=["observations"])

_COCO_PT = {
    "person": "pessoa", "car": "carro", "motorcycle": "moto", "bicycle": "bicicleta",
    "bus": "ônibus", "truck": "caminhão", "dog": "cachorro", "cat": "gato",
    "bird": "pássaro", "backpack": "mochila", "umbrella": "guarda-chuva",
}


def describe_frame(jpeg: bytes) -> tuple[str, list[str]]:
    """Descreve o frame por detecção de objetos (YOLO-det/COCO) → (texto PT, classes).

    Mesma lógica do monitor (ai/), replicada porque o monitor é um serviço à
    parte. Permite "Descrever agora" pela UI, sem esperar o loop do monitor.
    """
    from PIL import Image  # lazy

    img = Image.open(io.BytesIO(jpeg))
    from ultralytics import YOLO  # lazy/pesado

    result = YOLO("yolo11n.pt")(img)[0]
    names = result.names
    classes = [names[int(c)] for c in result.boxes.cls]
    if not classes:
        return "", []
    counts: dict[str, int] = {}
    for c in classes:
        counts[c] = counts.get(c, 0) + 1
    partes = [f"{n} {_COCO_PT.get(c, c)}" + ("s" if n > 1 else "") for c, n in counts.items()]
    return "Detectado: " + ", ".join(partes) + ".", classes


def _obs_dir() -> Path:
    return Path(settings.ai_data_dir) / "observations"


def _save_snapshot(jpeg: bytes) -> str:
    out = _obs_dir()
    out.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    (out / filename).write_bytes(jpeg)
    return filename


def _serialize(obs: Observation) -> dict:
    return {
        "id": obs.id,
        "camera_id": obs.camera_id,
        "description": obs.description,
        "objects": obs.objects_csv.split(",") if obs.objects_csv else [],
        "snapshot": obs.snapshot,
        "created_at": obs.created_at.isoformat(),
    }


class ConfigIn(BaseModel):
    enabled: bool


@router.get("/config")
def get_config(_: str = Depends(current_user)):
    return {"enabled": settings_store.vigilante_enabled()}


@router.put("/config")
def set_config(body: ConfigIn, _: str = Depends(current_user)):
    settings_store.set_vigilante(body.enabled)
    return {"enabled": body.enabled}


@router.get("")
def list_observations(
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    rows = session.exec(
        select(Observation).order_by(Observation.created_at.desc()).limit(100)
    ).all()
    return [_serialize(o) for o in rows]


@router.post("", status_code=201)
async def create_observation(
    camera_id: int = Form(...),
    description: str = Form(...),
    objects: str = Form(""),
    file: UploadFile | None = File(None),
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    snapshot = _save_snapshot(await file.read()) if file is not None else None
    obs = Observation(
        camera_id=camera_id, description=description, objects_csv=objects, snapshot=snapshot
    )
    session.add(obs)
    session.commit()
    session.refresh(obs)
    return _serialize(obs)


@router.post("/test")
async def test_describe(
    camera_id: int,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Descreve um frame da câmera AGORA (testar o vigilante pela UI)."""
    cam = session.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(404, "Câmera não encontrada")
    try:
        jpeg = await grab_frame(cam.name)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Frame indisponível: {exc}")
    if not jpeg:
        raise HTTPException(502, "go2rtc não entregou frame")
    text, objects = describe_frame(jpeg)
    if not text:
        return {"description": "Nada relevante detectado agora.", "objects": [], "saved": False}
    obs = Observation(
        camera_id=camera_id,
        description=text,
        objects_csv=",".join(objects),
        snapshot=_save_snapshot(jpeg),
    )
    session.add(obs)
    session.commit()
    session.refresh(obs)
    return {"description": text, "objects": objects, "saved": True}


@router.get("/{oid}/snapshot")
def observation_snapshot(
    oid: int,
    _: str = Depends(media_user),
    session: Session = Depends(get_session),
):
    obs = session.get(Observation, oid)
    if obs is None or obs.snapshot is None:
        raise HTTPException(404, "Snapshot não encontrado")
    path = _obs_dir() / obs.snapshot
    if not path.is_file():
        raise HTTPException(404, "Snapshot não encontrado")
    return FileResponse(path, media_type="image/jpeg")
