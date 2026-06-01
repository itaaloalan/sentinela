"""Buffer em memória dos logs recentes do backend.

Um handler de logging guarda as últimas N linhas num ring buffer pra UI poder
mostrar "o que está acontecendo" no backend sem depender de arquivo/stdout.
"""
import logging
from collections import deque

_MAX = 200
_BUFFER: deque[str] = deque(maxlen=_MAX)


class RingHandler(logging.Handler):
    """Acumula os registros formatados no ring buffer em memória."""

    def emit(self, record: logging.LogRecord) -> None:
        _BUFFER.append(self.format(record))


def install() -> None:
    """Instala o handler no logger raiz (idempotente)."""
    root = logging.getLogger()
    if any(isinstance(h, RingHandler) for h in root.handlers):
        return
    handler = RingHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    root.addHandler(handler)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)


def recent() -> list[str]:
    return list(_BUFFER)
