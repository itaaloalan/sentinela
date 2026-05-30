"""Autenticação simples (login + JWT). Single-user no MVP.

TODO (Fase 2): mover usuários para o SQLite e hashear a senha (passlib/bcrypt).
"""
import datetime as dt

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

from .config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
ALGO = "HS256"


def _make_token(sub: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": sub,
        "iat": now,
        "exp": now + dt.timedelta(minutes=settings.jwt_ttl_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGO)


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends()):
    if form.username != settings.admin_user or form.password != settings.admin_pass:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais inválidas")
    return {"access_token": _make_token(form.username), "token_type": "bearer"}


def current_user(token: str = Depends(oauth2)) -> str:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGO])
        return payload["sub"]
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido")
