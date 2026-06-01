import sys
import types

from sqlmodel import Session

from app import database, frames, training
from app.config import settings
from app.db_models import AIModel


def _make_model() -> int:
    with Session(database.engine) as s:
        rec = AIModel(camera_id=1, name="portao", classes_csv="aberto,fechado")
        s.add(rec)
        s.commit()
        s.refresh(rec)
        return rec.id


def _seed_frames(model_id: int, n: int = 5):
    for label in ("aberto", "fechado"):
        for _ in range(n):
            frames.save_frame(model_id, label, b"jpeg")


def _install_fake_ultralytics(monkeypatch, accuracy=0.95):
    class FakeResults:
        results_dict = {"metrics/accuracy_top1": accuracy}

    class FakeYOLO:
        def __init__(self, weights):
            pass

        def train(self, **kwargs):
            return FakeResults()

        def export(self, **kwargs):
            pass

    module = types.ModuleType("ultralytics")
    module.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", module)


def test_build_dataset_splits_train_val(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    mid = 1
    _seed_frames(mid, 5)
    dataset = training.build_dataset(mid, ["aberto", "fechado"])
    train_files = list((dataset / "train" / "aberto").glob("*.jpg"))
    val_files = list((dataset / "val" / "aberto").glob("*.jpg"))
    assert len(train_files) == 4  # 80%
    assert len(val_files) == 1
    # rodar de novo recria (cobre o ramo dataset.exists())
    dataset2 = training.build_dataset(mid, ["aberto", "fechado"])
    assert dataset2.exists()


def test_run_training_success(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    mid = _make_model()
    _seed_frames(mid, 5)
    _install_fake_ultralytics(monkeypatch, accuracy=0.9)
    training.run_training(mid, epochs=1)
    with Session(database.engine) as s:
        rec = s.get(AIModel, mid)
    assert rec.status == "pronto"
    assert rec.accuracy == 0.9
    assert rec.version == 1


def test_validate_frames_needs_two_ready_classes(monkeypatch, tmp_path):
    import pytest

    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    mid = 1
    # só 'fechado' pronta → 1 classe pronta → erro acionável
    for _ in range(3):
        frames.save_frame(mid, "fechado", b"jpeg")
    with pytest.raises(ValueError, match="pelo menos 2 classes"):
        training.validate_frames(mid, ["aberto", "fechado"])
    # com 2 classes prontas, devolve só as prontas (subconjunto)
    for _ in range(2):
        frames.save_frame(mid, "aberto", b"jpeg")
    assert sorted(training.validate_frames(mid, ["aberto", "fechado"])) == ["aberto", "fechado"]


def test_validate_frames_trains_on_ready_subset(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    mid = 1
    # 3 classes definidas, só 2 prontas ('agua' vazia) → treina nas 2 prontas
    for _ in range(2):
        frames.save_frame(mid, "aberto", b"jpeg")
        frames.save_frame(mid, "fechado", b"jpeg")
    ready = training.validate_frames(mid, ["aberto", "fechado", "agua"])
    assert sorted(ready) == ["aberto", "fechado"]


def test_run_training_one_class_sets_clear_error(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    mid = _make_model()
    for _ in range(3):
        frames.save_frame(mid, "fechado", b"jpeg")  # 'aberto' sem frames
    training.run_training(mid, epochs=1)
    with Session(database.engine) as s:
        rec = s.get(AIModel, mid)
    assert "pelo menos 2 classes" in rec.status
    assert rec.accuracy is None


def test_run_training_failure_sets_error(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    mid = _make_model()
    _seed_frames(mid, 2)
    monkeypatch.setitem(sys.modules, "ultralytics", None)  # ImportError no treino
    training.run_training(mid, epochs=1)
    with Session(database.engine) as s:
        rec = s.get(AIModel, mid)
    assert rec.status.startswith("erro")  # status carrega o motivo
    assert rec.accuracy is None
