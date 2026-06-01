"""Tabelas SQLModel persistidas em SQLite (Fase 2).

Apenas `User` e `Camera` por enquanto. Os modelos de IA e eventos seguem em
memória (ver `db.py`) até a Fase 4/5.
"""
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    """Usuário único do MVP. Senha guardada como hash (nunca em texto puro)."""

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str


class Camera(SQLModel, table=True):
    """Câmera cadastrada.

    `name` é único porque é a **chave do stream no go2rtc** (e a chave usada
    pelo proxy de snapshot em `/api/frame.jpeg?src=<name>`).
    """

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    source: str
    kind: str = "rtsp"          # "dvrip" | "rtsp" | "onvif"
    ptz_enabled: bool = False
