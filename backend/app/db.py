"""Stores em memória das peças ainda não migradas para o SQLite.

`users` e `cameras` já vivem no SQLite (ver `database.py` / `db_models.py`).
`ai_models` e `events` continuam em memória até a Fase 4/5.
"""
from itertools import count

_id = count(1)


def next_id() -> int:
    return next(_id)


# stores em memória (migrar para SQLite na Fase 4/5)
ai_models: dict[int, dict] = {}
events: list[dict] = []
