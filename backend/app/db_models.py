"""Tabelas SQLModel persistidas em SQLite."""
import datetime as dt

from sqlmodel import Field, SQLModel


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class User(SQLModel, table=True):
    """Usuário do sistema. Senha guardada como hash (nunca em texto puro).

    `role`: "admin" (gerencia tudo) ou "familiar" (acesso de visualização).
    """

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    role: str = "admin"


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


class AIModel(SQLModel, table=True):
    """Modelo de classificação treinável (ex.: portão aberto/fechado).

    Frames ficam em disco (ver `frames.py`); aqui só os metadados.
    `classes_csv` e `crop_json` guardam listas/objetos como string simples.
    """

    id: int | None = Field(default=None, primary_key=True)
    camera_id: int
    name: str = "portao"
    classes_csv: str = "aberto,fechado"
    alert_label: str | None = None    # classe que dispara o alerta (default: 1ª)
    debounce_seconds: int | None = None  # tempo contínuo no alert_label p/ disparar
    crop_json: str | None = None      # JSON {x1,y1,x2,y2} ou None
    version: int = 0
    accuracy: float | None = None
    active: bool = False
    status: str = "novo"              # novo | treinando | pronto | erro


class Setting(SQLModel, table=True):
    """Configuração editável em runtime (ex.: tópico do ntfy), sobrepõe o .env."""

    key: str = Field(primary_key=True)
    value: str


class Event(SQLModel, table=True):
    """Evento detectado pelo monitor (ex.: portão aberto). Snapshot em disco."""

    id: int | None = Field(default=None, primary_key=True)
    model_id: int
    camera_id: int
    label: str
    snapshot: str                     # nome do arquivo do snapshot
    created_at: dt.datetime = Field(default_factory=_now)


class CameraView(SQLModel, table=True):
    """Histórico de acesso: quem abriu o painel/câmeras e quando."""

    id: int | None = Field(default=None, primary_key=True)
    username: str
    camera_id: int | None = None      # None = abriu o painel (todas)
    created_at: dt.datetime = Field(default_factory=_now)


class Observation(SQLModel, table=True):
    """Observação do Modo Vigilante: descrição do que a IA viu num frame."""

    id: int | None = Field(default=None, primary_key=True)
    camera_id: int
    description: str
    objects_csv: str = ""             # classes detectadas (ex.: "person,dog")
    snapshot: str | None = None       # nome do arquivo do snapshot (opcional)
    created_at: dt.datetime = Field(default_factory=_now)
