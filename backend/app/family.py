"""Recursos para família: perfis de acesso, histórico de visualização e
botão de emergência.

- Usuários com papel admin/familiar (CRUD só para admin) = compartilhamento.
- Histórico: quem abriu o painel/câmeras e quando (admin vê tudo).
- Emergência: dispara alerta urgente (ntfy + Discord) — testável pela UI.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from . import notify
from .auth import current_user, require_admin
from .database import get_session, password_hash
from .db_models import CameraView, User

router = APIRouter(prefix="/api/family", tags=["family"])

_ROLES = {"admin", "familiar"}


class UserIn(BaseModel):
    username: str
    password: str
    role: str = "familiar"


class ViewIn(BaseModel):
    camera_id: int | None = None


def _ser_user(u: User) -> dict:
    return {"id": u.id, "username": u.username, "role": u.role}


@router.get("/users")
def list_users(_: str = Depends(require_admin), session: Session = Depends(get_session)):
    return [_ser_user(u) for u in session.exec(select(User).order_by(User.username)).all()]


@router.post("/users", status_code=201)
def create_user(
    body: UserIn,
    _: str = Depends(require_admin),
    session: Session = Depends(get_session),
):
    if body.role not in _ROLES:
        raise HTTPException(422, "Papel inválido (use 'admin' ou 'familiar')")
    if session.exec(select(User).where(User.username == body.username)).first():
        raise HTTPException(409, "Já existe um usuário com esse nome")
    user = User(
        username=body.username,
        password_hash=password_hash.hash(body.password),
        role=body.role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return _ser_user(user)


@router.delete("/users/{uid}")
def delete_user(
    uid: int,
    me: str = Depends(require_admin),
    session: Session = Depends(get_session),
):
    user = session.get(User, uid)
    if user is None:
        raise HTTPException(404, "Usuário não encontrado")
    # o bloqueio de auto-exclusão já garante que sempre reste ≥1 admin (o admin
    # logado não pode se apagar; qualquer outro admin implica ≥2 admins).
    if user.username == me:
        raise HTTPException(400, "Não dá para excluir você mesmo")
    session.delete(user)
    session.commit()
    return {"deleted": uid}


@router.post("/views", status_code=201)
def record_view(
    body: ViewIn,
    me: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    view = CameraView(username=me, camera_id=body.camera_id)
    session.add(view)
    session.commit()
    session.refresh(view)
    return {"id": view.id}


@router.get("/views")
def list_views(_: str = Depends(require_admin), session: Session = Depends(get_session)):
    rows = session.exec(
        select(CameraView).order_by(CameraView.created_at.desc()).limit(100)
    ).all()
    return [
        {
            "id": r.id,
            "username": r.username,
            "camera_id": r.camera_id,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/emergency")
async def emergency(_: str = Depends(current_user)):
    try:
        await notify.send_emergency()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Falha ao enviar emergência: {exc}")
    return {"sent": True}
