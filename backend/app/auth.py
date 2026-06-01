"""Autenticação simples (login + JWT). Single-user no MVP.

Usuário e hash da senha vivem no SQLite (ver `database.py`). O login verifica
a senha contra o hash; nunca compara texto puro.
"""
import datetime as dt

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlmodel import Session, select

from .config import settings
from .database import get_session, password_hash
from .db_models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
# auto_error=False: usado por endpoints de mídia que aceitam o token na query.
oauth2_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)
ALGO = "HS256"


def _subject_from_token(token: str) -> str:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGO])["sub"]
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido")


def _make_token(sub: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": sub,
        "iat": now,
        "exp": now + dt.timedelta(minutes=settings.jwt_ttl_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGO)


@router.post("/login")
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    user = session.exec(select(User).where(User.username == form.username)).first()
    if user is None or not password_hash.verify(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais inválidas")
    return {"access_token": _make_token(user.username), "token_type": "bearer"}


def current_user(token: str = Depends(oauth2)) -> str:
    return _subject_from_token(token)


def media_user(
    header_token: str | None = Depends(oauth2_optional),
    token: str | None = Query(default=None),
) -> str:
    """Auth para endpoints de mídia: token via header OU query (`?token=`).

    Tags <img>/<video> não enviam o header Authorization, então aceitamos o
    JWT na query string.
    """
    raw = header_token or token
    if raw is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token ausente")
    return _subject_from_token(raw)
