"""Persistência (placeholder do skeleton).

TODO (Fase 2+): trocar por SQLite real (SQLModel/SQLAlchemy) com tabelas:
  - users(id, username, password_hash)
  - cameras(id, name, source, kind, ptz_enabled)
  - models(id, camera_id, name, classes, crop, version, accuracy, active)
  - events(id, model_id, camera_id, label, snapshot_path, created_at)

Por enquanto, stores em memória para o skeleton rodar sem dependências de DB.
"""
from itertools import count

_id = count(1)


def next_id() -> int:
    return next(_id)


# stores em memória (substituir por SQLite)
cameras: dict[int, dict] = {}
ai_models: dict[int, dict] = {}
events: list[dict] = []
