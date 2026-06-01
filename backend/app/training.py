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


def ready_classes(model_id: int, classes: list[str]) -> list[str]:
    """Classes que já têm frames suficientes (treino+validação) para entrar no treino."""
    return [c for c in classes if frames_mod.count_frames(model_id, c) >= _MIN_PER_CLASS]


def validate_frames(model_id: int, classes: list[str]) -> list[str]:
    """Garante material suficiente e devolve as classes prontas p/ treinar.

    Treina com o subconjunto de classes que já têm frames (≥2). Assim dá pra ter
    um modelo com classes ainda vazias (ex.: 'agua' sem água acumulada ainda) e
    treinar nas que estão prontas — mas são necessárias ≥2, senão o classificador
    não tem o que distinguir. Erro vira texto acionável no status na UI.
    """
    ready = ready_classes(model_id, classes)
    if len(ready) < 2:
        counts = {c: frames_mod.count_frames(model_id, c) for c in classes}
        atual = ", ".join(f"'{c}' ({n})" for c, n in counts.items())
        raise ValueError(
            f"preciso de pelo menos 2 classes com {_MIN_PER_CLASS}+ frames cada "
            f"(a IA precisa ver os dois estados pra distinguir). Hoje: {atual}"
        )
    return ready


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
    # salva em <ai_data>/<id>/run/weights/best.pt (onde a inferência procura).
    # project PRECISA ser absoluto: com caminho relativo o Ultralytics prefixa o
    # próprio runs_dir (./runs/...) e a inferência não acha o best.pt.
    results = model.train(
        data=str(dataset.resolve()),
        epochs=epochs,
        imgsz=224,
        project=str(dataset.parent.resolve()),
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
        ready = validate_frames(model_id, classes)
        dataset = build_dataset(model_id, ready)  # só as classes prontas
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
