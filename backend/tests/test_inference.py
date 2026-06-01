import io
import sys
import types

import httpx
import pytest
import respx
from PIL import Image

from app import inference
from app.config import settings
from app.db_models import AIModel, Camera

FRAME_URL = f"{settings.go2rtc_url}/api/frame.jpeg"


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, "JPEG")
    return buf.getvalue()


def _model(mid=1):
    m = AIModel(camera_id=1, name="portao", classes_csv="aberto,fechado")
    m.id = mid
    return m


def _install_fake_yolo(monkeypatch):
    class FakeProbs:
        top1 = 0
        top1conf = 0.88

    class FakeResult:
        probs = FakeProbs()
        names = {0: "aberto", 1: "fechado"}

    class FakeYOLO:
        def __init__(self, weights):
            pass

        def __call__(self, img):
            return [FakeResult()]

    module = types.ModuleType("ultralytics")
    module.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", module)


def _touch_weights(mid):
    p = inference.weights_path(mid)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"weights")


async def test_classify_live_without_crop(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    _touch_weights(1)
    _install_fake_yolo(monkeypatch)
    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=_jpeg()))
        out = await inference.classify_live(_model(1), Camera(name="portao", source="x"), None)
    assert out == {"label": "aberto", "confidence": 0.88}


async def test_classify_live_with_crop(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    _touch_weights(1)
    _install_fake_yolo(monkeypatch)
    crop = {"x1": 0, "y1": 0, "x2": 20, "y2": 20}
    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=_jpeg()))
        out = await inference.classify_live(_model(1), Camera(name="portao", source="x"), crop)
    assert out["label"] == "aberto"


async def test_classify_live_not_trained(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    with pytest.raises(RuntimeError, match="treinado"):
        await inference.classify_live(_model(1), Camera(name="portao", source="x"), None)


async def test_classify_live_caches_model_and_reloads_on_retrain(monkeypatch, tmp_path):
    import os

    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    _touch_weights(1)
    inference._model_cache.clear()

    builds = {"n": 0}

    class FakeProbs:
        top1 = 0
        top1conf = 0.5

    class FakeResult:
        probs = FakeProbs()
        names = {0: "a", 1: "b"}

    class CountingYOLO:
        def __init__(self, weights):
            builds["n"] += 1

        def __call__(self, img):
            return [FakeResult()]

    module = types.ModuleType("ultralytics")
    module.YOLO = CountingYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", module)
    cam = Camera(name="portao", source="x")

    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=_jpeg()))
        await inference.classify_live(_model(1), cam, None)
        await inference.classify_live(_model(1), cam, None)  # cache hit
    assert builds["n"] == 1  # carregou só 1x

    # re-treino muda o mtime do best.pt → invalida o cache
    w = inference.weights_path(1)
    os.utime(w, (w.stat().st_atime, w.stat().st_mtime + 10))
    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=_jpeg()))
        await inference.classify_live(_model(1), cam, None)
    assert builds["n"] == 2  # recarregou após o re-treino


async def test_classify_live_empty_frame(monkeypatch, tmp_path):
    # go2rtc devolve 200 com corpo vazio (câmera sem stream) → erro acionável
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    _touch_weights(1)
    with respx.mock:
        respx.get(FRAME_URL).mock(return_value=httpx.Response(200, content=b""))
        with pytest.raises(RuntimeError, match="não entregou frame"):
            await inference.classify_live(_model(1), Camera(name="portao", source="x"), None)
