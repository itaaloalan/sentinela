"""API de modelos de IA / treino do portão (stubs do skeleton).

Implementa o contrato de docs/AI-GATE.md. Aqui só os stubs em memória; a Fase 4
liga isto ao serviço ai/ (trainer.py / monitor.py).
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel

from . import db
from .auth import current_user

router = APIRouter(prefix="/api/models", tags=["models"])


class ModelIn(BaseModel):
    camera_id: int
    name: str = "portao"
    classes: list[str] = ["aberto", "fechado"]


class Crop(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int


@router.post("", status_code=201)
def create_model(m: ModelIn, _: str = Depends(current_user)):
    mid = db.next_id()
    rec = {
        "id": mid, **m.model_dump(),
        "crop": None, "version": 0, "accuracy": None,
        "active": False, "status": "novo", "frames": 0,
    }
    db.ai_models[mid] = rec
    return rec


@router.get("")
def list_models(_: str = Depends(current_user)):
    return list(db.ai_models.values())


def _get(mid: int) -> dict:
    rec = db.ai_models.get(mid)
    if not rec:
        raise HTTPException(404, "Modelo não encontrado")
    return rec


@router.post("/{mid}/frames")
async def add_frame(mid: int, label: str, file: UploadFile, _: str = Depends(current_user)):
    rec = _get(mid)
    if label not in rec["classes"]:
        raise HTTPException(400, f"label deve ser uma de {rec['classes']}")
    # TODO (Fase 4): salvar em ai/data/<modelo>/<label>/ e contabilizar
    rec["frames"] += 1
    return {"ok": True, "frames": rec["frames"]}


@router.put("/{mid}/crop")
def set_crop(mid: int, crop: Crop, _: str = Depends(current_user)):
    rec = _get(mid)
    rec["crop"] = crop.model_dump()
    return rec


@router.post("/{mid}/train")
def train(mid: int, _: str = Depends(current_user)):
    rec = _get(mid)
    # TODO (Fase 4): enfileirar job no ai/trainer.py (yolo classify train)
    rec["status"] = "treinando"
    return {"ok": True, "status": rec["status"]}


@router.get("/{mid}/status")
def status(mid: int, _: str = Depends(current_user)):
    rec = _get(mid)
    return {"status": rec["status"], "accuracy": rec["accuracy"], "version": rec["version"]}


@router.post("/{mid}/test")
def test(mid: int, _: str = Depends(current_user)):
    _get(mid)
    # TODO (Fase 4): rodar inferência num frame ao vivo
    return {"label": None, "confidence": None, "detail": "stub — implementar na Fase 4"}


@router.post("/{mid}/activate")
def activate(mid: int, active: bool = True, _: str = Depends(current_user)):
    rec = _get(mid)
    rec["active"] = active
    # TODO (Fase 5): ligar/desligar o ai/monitor.py para este modelo
    return {"id": mid, "active": rec["active"]}
