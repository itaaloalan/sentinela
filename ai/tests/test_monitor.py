import io
import sys
import types

import httpx
import respx
from PIL import Image

import monitor


# ---- Debouncer (lógica pura) ----

def test_debouncer_fires_after_hold_once():
    d = monitor.Debouncer("aberto", 10)
    assert d.update("fechado", 0) is False      # não-alerta
    assert d.update("aberto", 100) is False     # marca início
    assert d.update("aberto", 105) is False     # ainda dentro do hold
    assert d.update("aberto", 110) is True       # atingiu o hold → dispara
    assert d.update("aberto", 200) is False     # já disparou
    assert d.update("fechado", 201) is False    # reseta
    assert d.update("aberto", 201) is False     # recomeça a contagem


# ---- classify (PIL real + ultralytics fake) ----

def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (30, 30), "white").save(buf, "JPEG")
    return buf.getvalue()


def _fake_ultralytics(monkeypatch):
    class FakeProbs:
        top1 = 0
        top1conf = 0.9

    class FakeResult:
        probs = FakeProbs()
        names = {0: "aberto", 1: "fechado"}

    class FakeYOLO:
        def __init__(self, w):
            pass

        def __call__(self, img):
            return [FakeResult()]

    mod = types.ModuleType("ultralytics")
    mod.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", mod)


def test_classify_with_and_without_crop(monkeypatch):
    _fake_ultralytics(monkeypatch)
    label, conf = monitor.classify("w.pt", _jpeg(), None)
    assert (label, conf) == ("aberto", 0.9)
    label2, _ = monitor.classify("w.pt", _jpeg(), {"x1": 0, "y1": 0, "x2": 10, "y2": 10})
    assert label2 == "aberto"


def test_weights_path():
    assert monitor.weights_path(7).endswith("/7/run/weights/best.pt")


# ---- login / post_event / cycle (httpx via respx) ----

@respx.mock
def test_login_returns_token():
    respx.post(f"{monitor.BACKEND_URL}/api/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "tok"})
    )
    with httpx.Client() as client:
        assert monitor.login(client) == "tok"


@respx.mock
def test_cycle_fires_event(monkeypatch):
    monkeypatch.setattr(monitor, "DEBOUNCE", 0)  # dispara já na 1ª leitura "aberto"
    monkeypatch.setattr(monitor, "_trained", lambda mid: True)
    monkeypatch.setattr(monitor, "classify", lambda w, j, c: ("aberto", 0.95))
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[
            {"id": 1, "camera_id": 1, "active": True, "crop": None},
            {"id": 2, "camera_id": 1, "active": False, "crop": None},   # inativo → pula
            {"id": 3, "camera_id": 99, "active": True, "crop": None},   # sem câmera → pula
        ])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "portao"}])
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    events = respx.post(f"{monitor.BACKEND_URL}/api/events").mock(
        return_value=httpx.Response(201, json={"id": 1})
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})
    assert events.called


@respx.mock
def test_cycle_skips_low_confidence(monkeypatch):
    monkeypatch.setattr(monitor, "_trained", lambda mid: True)
    monkeypatch.setattr(monitor, "classify", lambda w, j, c: ("aberto", 0.1))  # < threshold
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "camera_id": 1, "active": True, "crop": None}])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "portao"}])
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    events = respx.post(f"{monitor.BACKEND_URL}/api/events").mock(
        return_value=httpx.Response(201)
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})
    assert not events.called


@respx.mock
def test_cycle_no_fire_before_debounce(monkeypatch):
    # alerta com confiança ok, mas debounce alto → 1ª leitura não dispara
    monkeypatch.setattr(monitor, "DEBOUNCE", 999)
    monkeypatch.setattr(monitor, "_trained", lambda mid: True)
    monkeypatch.setattr(monitor, "classify", lambda w, j, c: ("aberto", 0.95))
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "camera_id": 1, "active": True, "crop": None}])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "portao"}])
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    events = respx.post(f"{monitor.BACKEND_URL}/api/events").mock(
        return_value=httpx.Response(201)
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})
    assert not events.called


@respx.mock
def test_cycle_handles_model_error(monkeypatch, capsys):
    # erro num modelo (ex.: ultralytics ausente) é logado e não derruba o loop
    def _boom(*a):
        raise RuntimeError("sem ultralytics")

    monkeypatch.setattr(monitor, "_trained", lambda mid: True)
    monkeypatch.setattr(monitor, "classify", _boom)
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "camera_id": 1, "active": True, "crop": None}])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "portao"}])
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})  # não levanta
    assert "erro no modelo 1" in capsys.readouterr().out


@respx.mock
def test_cycle_skips_untrained_model(monkeypatch, capsys):
    # modelo ativo mas sem best.pt ainda → pula sem poluir o log e sem buscar frame
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "camera_id": 1, "active": True, "crop": None}])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "portao"}])
    )
    frame = respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})  # _trained real → False (sem arquivo)
    assert not frame.called
    assert capsys.readouterr().out == ""


@respx.mock
def test_cycle_empty_frame_reports_clear_error(monkeypatch, capsys):
    # go2rtc devolve 200 com corpo vazio quando não alcança a câmera (ex.: VPN
    # sequestrando a rota). Deve virar erro legível, não "cannot identify image".
    monkeypatch.setattr(monitor, "_trained", lambda mid: True)
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "camera_id": 1, "active": True, "crop": None}])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "portao"}])
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"")
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})  # não levanta
    out = capsys.readouterr().out
    assert "erro no modelo 1" in out
    assert "offline/inacessível" in out


@respx.mock
def test_post_event():
    route = respx.post(f"{monitor.BACKEND_URL}/api/events").mock(
        return_value=httpx.Response(201, json={"id": 9})
    )
    with httpx.Client() as client:
        monitor.post_event(client, "tok", 1, "aberto", b"jpeg")
    assert route.called


# ---- run() (loop) ----

def test_run_loops_then_exits(monkeypatch, capsys):
    monkeypatch.setattr(monitor, "login", lambda client: "tok")
    seen = {"cycles": 0}
    monkeypatch.setattr(monitor, "cycle", lambda c, t, d: seen.update(cycles=seen["cycles"] + 1))

    def _sleep(_s):
        raise KeyboardInterrupt

    monkeypatch.setattr(monitor.time, "sleep", _sleep)
    monitor.run()
    assert seen["cycles"] == 1
    assert "encerrado" in capsys.readouterr().out
