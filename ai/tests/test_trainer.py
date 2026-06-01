"""Testes do trainer com um módulo `ultralytics` falso injetado em sys.modules.

Não dependemos do ultralytics real (dep pesada, AGPL). O import é lazy dentro de
`train_model`, então conseguimos cobrir tanto o caminho feliz quanto o ImportError.
"""
import sys
import types

import pytest

import trainer


class _FakeResults:
    results_dict = {"metrics/accuracy_top1": 0.9}


def _install_fake_ultralytics(monkeypatch):
    captured = {}

    class FakeYOLO:
        def __init__(self, weights):
            captured["weights"] = weights

        def train(self, **kwargs):
            captured["train_kwargs"] = kwargs
            return _FakeResults()

        def export(self, **kwargs):
            captured["export_kwargs"] = kwargs

    module = types.ModuleType("ultralytics")
    module.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", module)
    return captured


def test_train_model_happy_path(tmp_path, monkeypatch):
    captured = _install_fake_ultralytics(monkeypatch)
    monkeypatch.setattr(trainer, "DATA_DIR", tmp_path)
    (tmp_path / "portao").mkdir()

    result = trainer.train_model("portao", epochs=3, imgsz=128)

    assert result["accuracy"] == 0.9
    assert result["weights"].endswith("portao/weights")
    assert captured["weights"] == "yolo11n-cls.pt"
    assert captured["train_kwargs"]["epochs"] == 3
    assert captured["export_kwargs"]["format"] == "onnx"


def test_train_model_missing_dataset(tmp_path, monkeypatch):
    _install_fake_ultralytics(monkeypatch)
    monkeypatch.setattr(trainer, "DATA_DIR", tmp_path)
    with pytest.raises(FileNotFoundError):
        trainer.train_model("nao-existe")


def test_train_model_without_ultralytics(monkeypatch):
    # Garante que importar ultralytics falhe → RuntimeError amigável.
    monkeypatch.setitem(sys.modules, "ultralytics", None)
    with pytest.raises(RuntimeError, match="ultralytics"):
        trainer.train_model("portao")
