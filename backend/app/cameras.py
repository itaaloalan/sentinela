"""CRUD de câmeras (SQLite) + registro no go2rtc + proxy de snapshot.

Ao criar/remover uma câmera, registramos/desregistramos o stream no go2rtc em
runtime (best-effort — ver `go2rtc.py`). O snapshot é proxiado de forma
autenticada (a porta 1984 do go2rtc não é exposta).
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from . import discovery
from .auth import current_user
from .config import settings
from .database import get_session
from .db_models import Camera
from .go2rtc import register_stream, unregister_stream

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraIn(BaseModel):
    name: str
    source: str            # ex.: dvrip://... ou rtsp://...
    kind: str = "rtsp"     # "dvrip" | "rtsp" | "onvif"
    ptz_enabled: bool = False


class CameraOut(CameraIn):
    id: int


@router.get("/discover")
async def discover_cameras(_: str = Depends(current_user)):
    """Varre a LAN e sugere câmeras para cadastro (ver app/discovery.py)."""
    return await discovery.discover()


@router.get("", response_model=list[CameraOut])
def list_cameras(
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    return session.exec(select(Camera)).all()


@router.post("", response_model=CameraOut, status_code=201)
async def create_camera(
    cam: CameraIn,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    record = Camera(**cam.model_dump())
    session.add(record)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Já existe uma câmera com esse nome")
    session.refresh(record)
    await register_stream(record.name, record.source)
    return record


@router.delete("/{cid}", status_code=204)
async def delete_camera(
    cid: int,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    cam = session.get(Camera, cid)
    if cam is not None:
        await unregister_stream(cam.name)
        session.delete(cam)
        session.commit()
    return Response(status_code=204)


@router.get("/{cid}/snapshot")
async def snapshot(
    cid: int,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    """Proxy autenticado do snapshot do go2rtc (não expor a 1984 direto)."""
    cam = session.get(Camera, cid)
    if cam is None:
        raise HTTPException(404, "Câmera não encontrada")
    url = f"{settings.go2rtc_url}/api/frame.jpeg?src={cam.name}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(url)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"go2rtc indisponível: {e}")
    return Response(content=r.content, media_type="image/jpeg", status_code=r.status_code)
