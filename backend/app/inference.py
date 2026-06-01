"""Inferência de teste: classifica um frame ao vivo com o modelo treinado.

Usa os pesos salvos pelo treino (app/training.py) e aplica o crop do modelo.
Imports pesados (ultralytics, PIL) são lazy. Chamado por POST /api/models/{id}/test.
"""
import io
from pathlib import Path

from .config import settings
from .db_models import AIModel, Camera
from .go2rtc import grab_frame


def weights_path(model_id: int) -> Path:
    return Path(settings.ai_data_dir) / str(model_id) / "run" / "weights" / "best.pt"


# cache do modelo carregado (carregar o YOLO a cada teste é lento). Chaveado pelo
# caminho dos pesos + mtime, então re-treinar (novo best.pt) invalida sozinho.
_model_cache: dict[str, tuple[float, object]] = {}


def _load_model(weights: Path):
    from ultralytics import YOLO  # lazy/pesado

    key = str(weights)
    mtime = weights.stat().st_mtime
    cached = _model_cache.get(key)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    model = YOLO(key)
    _model_cache[key] = (mtime, model)
    return model


async def classify_live(model: AIModel, camera: Camera, crop: dict | None) -> dict:
    """Pega um frame ao vivo, aplica o crop e classifica. label + confidence."""
    weights = weights_path(model.id)
    if not weights.is_file():
        raise RuntimeError("Modelo ainda não treinado")

    jpeg = await grab_frame(camera.name)
    if not jpeg:
        raise RuntimeError(
            f"go2rtc não entregou frame de '{camera.name}' — câmera offline ou "
            "sem stream (RTSP timeout / VPN na rota da LAN?)"
        )

    from PIL import Image  # lazy

    img = Image.open(io.BytesIO(jpeg))
    if crop is not None:
        img = img.crop((crop["x1"], crop["y1"], crop["x2"], crop["y2"]))

    result = _load_model(weights)(img)[0]
    probs = result.probs
    return {"label": result.names[probs.top1], "confidence": float(probs.top1conf)}
