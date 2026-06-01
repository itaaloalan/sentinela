"""Armazenamento dos frames rotulados em disco (dataset da IA).

Layout: <AI_DATA_DIR>/<model_id>/<label>/<timestamp>.jpg
Os metadados do modelo ficam no SQLite (ver db_models.AIModel).
"""
import re
import shutil
import time
import uuid
from pathlib import Path

from .config import settings

# nome de arquivo seguro (evita path traversal ao servir/excluir)
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


def _base() -> Path:
    return Path(settings.ai_data_dir)


def model_dir(model_id: int, label: str) -> Path:
    return _base() / str(model_id) / label


def save_frame(model_id: int, label: str, jpeg: bytes) -> str:
    out = model_dir(model_id, label)
    out.mkdir(parents=True, exist_ok=True)
    # timestamp p/ ordenação + sufixo único p/ não colidir em capturas rápidas
    filename = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}.jpg"
    (out / filename).write_bytes(jpeg)
    return filename


def list_frames(model_id: int, label: str) -> list[str]:
    out = model_dir(model_id, label)
    if not out.is_dir():
        return []
    return sorted(p.name for p in out.glob("*.jpg"))


def count_frames(model_id: int, label: str) -> int:
    return len(list_frames(model_id, label))


def frame_path(model_id: int, label: str, filename: str) -> Path | None:
    if not _SAFE_NAME.match(filename):
        return None
    path = model_dir(model_id, label) / filename
    return path if path.is_file() else None


def delete_frame(model_id: int, label: str, filename: str) -> bool:
    path = frame_path(model_id, label, filename)
    if path is None:
        return False
    path.unlink()
    return True


def rename_label(model_id: int, old: str, new: str) -> None:
    """Move os frames de um label para outro (ao renomear uma classe na UI)."""
    src = model_dir(model_id, old)
    if not src.is_dir():
        return
    dst = model_dir(model_id, new)
    dst.mkdir(parents=True, exist_ok=True)
    for p in src.glob("*.jpg"):
        p.rename(dst / p.name)
    shutil.rmtree(src, ignore_errors=True)


def delete_model_data(model_id: int) -> None:
    """Apaga todos os frames/dataset/pesos do modelo (ao excluí-lo)."""
    shutil.rmtree(_base() / str(model_id), ignore_errors=True)
