"""Treino real do classificador (YOLO-cls) em background.

Monta o dataset a partir dos frames rotulados em disco, roda o treino
(Ultralytics, import lazy/pesado) e atualiza status/accuracy/version do modelo
no SQLite. Chamado via BackgroundTasks pelo endpoint POST /api/models/{id}/train.
"""
import shutil
from pathlib import Path

from sqlmodel import Session

from . import frames as frames_mod
from .config import settings
from .database import engine
from .db_models import AIModel

_TRAIN_SPLIT = 0.8
_MIN_PER_CLASS = 2  # 1 p/ treino + 1 p/ validação, no mínimo


def validate_frames(model_id: int, classes: list[str]) -> None:
    """Garante material suficiente antes de chamar o YOLO.

    Sem isso o Ultralytics falha com mensagens crípticas (ex.: 'val: None' →
    'expected str, bytes or os.PathLike object, not NoneType'). Aqui o erro
    vira texto acionável que aparece no status do modelo na UI.
    """
    counts = {label: frames_mod.count_frames(model_id, label) for label in classes}
    faltando = [f"'{label}' ({n})" for label, n in counts.items() if n < _MIN_PER_CLASS]
    if faltando:
        raise ValueError(
            "frames insuficientes — capture pelo menos "
            f"{_MIN_PER_CLASS} por classe (treino+validação). Faltando: "
            + ", ".join(faltando)
        )


def build_dataset(model_id: int, classes: list[str]) -> Path:
    """Monta <ai_data>/<id>/dataset/{train,val}/<label> a partir dos frames."""
    dataset = Path(settings.ai_data_dir) / str(model_id) / "dataset"
    if dataset.exists():
        shutil.rmtree(dataset)
    for label in classes:
        files = frames_mod.list_frames(model_id, label)
        split = max(1, int(len(files) * _TRAIN_SPLIT))
        src_dir = frames_mod.model_dir(model_id, label)
        for i, filename in enumerate(files):
            sub = "train" if i < split else "val"
            dest = dataset / sub / label
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy(src_dir / filename, dest / filename)
    return dataset


def _train_yolo(dataset: Path, epochs: int) -> float:
    from ultralytics import YOLO  # import pesado/lazy (AGPL)

    model = YOLO("yolo11n-cls.pt")
    # salva em <ai_data>/<id>/run/weights/best.pt (onde a inferência procura)
    results = model.train(
        data=str(dataset),
        epochs=epochs,
        imgsz=224,
        project=str(dataset.parent),
        name="run",
        exist_ok=True,
    )
    model.export(format="onnx")
    return float(results.results_dict.get("metrics/accuracy_top1", 0.0))


def run_training(model_id: int, epochs: int = 30) -> None:
    """Treina e persiste o resultado. Nunca levanta — grava status 'erro'."""
    with Session(engine) as session:
        rec = session.get(AIModel, model_id)
        classes = rec.classes_csv.split(",")
    try:
        validate_frames(model_id, classes)
        dataset = build_dataset(model_id, classes)
        accuracy: float | None = _train_yolo(dataset, epochs)
        status = "pronto"
    except Exception as exc:
        # guarda o motivo no status para aparecer na UI (ex.: ultralytics
        # ausente, classe sem frames, etc.)
        accuracy, status = None, f"erro: {str(exc)[:200]}"

    with Session(engine) as session:
        rec = session.get(AIModel, model_id)
        rec.status = status
        if accuracy is not None:
            rec.accuracy = accuracy
            rec.version += 1
        session.add(rec)
        session.commit()
