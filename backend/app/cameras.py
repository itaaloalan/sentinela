"""CRUD de câmeras + proxy de snapshot do go2rtc (stub do skeleton).

TODO (Fase 1-2):
  - persistir em SQLite
  - ao criar câmera, registrar a stream no go2rtc via REST (PUT /api/streams)
  - PTZ via ONVIF (Fase 3): POST /api/cameras/{id}/ptz
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from . import db
from .auth import current_user
from .config import settings

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraIn(BaseModel):
    name: str
    source: str            # ex.: dvrip://... ou rtsp://...
    kind: str = "rtsp"     # "dvrip" | "rtsp" | "onvif"
    ptz_enabled: bool = False


class Camera(CameraIn):
    id: int


@router.get("", response_model=list[Camera])
def list_cameras(_: str = Depends(current_user)):
    return list(db.cameras.values())


@router.post("", response_model=Camera, status_code=201)
def create_camera(cam: CameraIn, _: str = Depends(current_user)):
    cid = db.next_id()
    record = {"id": cid, **cam.model_dump()}
    db.cameras[cid] = record
    # TODO: registrar stream no go2rtc aqui
    return record


@router.delete("/{cid}", status_code=204)
def delete_camera(cid: int, _: str = Depends(current_user)):
    db.cameras.pop(cid, None)
    return Response(status_code=204)


@router.get("/{cid}/snapshot")
async def snapshot(cid: int, _: str = Depends(current_user)):
    """Proxy autenticado do snapshot do go2rtc (não expor a 1984 direto)."""
    cam = db.cameras.get(cid)
    if not cam:
        raise HTTPException(404, "Câmera não encontrada")
    url = f"{settings.go2rtc_url}/api/frame.jpeg?src={cam['name']}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(url)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"go2rtc indisponível: {e}")
    return Response(content=r.content, media_type="image/jpeg", status_code=r.status_code)
