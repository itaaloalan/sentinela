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


def test_trained_checks_weights_file(monkeypatch, tmp_path):
    monkeypatch.setattr(monitor, "AI_DATA_DIR", str(tmp_path))
    assert monitor._trained(1) is False
    w = tmp_path / "1" / "run" / "weights"
    w.mkdir(parents=True)
    (w / "best.pt").write_bytes(b"x")
    assert monitor._trained(1) is True


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
    monkeypatch.setattr(monitor, "_trained", lambda mid: False)
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


@respx.mock
def test_cycle_uses_per_model_alert_and_debounce(monkeypatch):
    # modelo com alert_label/debounce próprios → dispara nesse label, com debounce 0
    monkeypatch.setattr(monitor, "_trained", lambda mid: True)
    monkeypatch.setattr(monitor, "classify", lambda w, j, c: ("vazamento", 0.95))
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[
            {"id": 1, "camera_id": 1, "active": True, "crop": None,
             "alert_label": "vazamento", "debounce_seconds": 0},
        ])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "pia"}])
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    events = respx.post(f"{monitor.BACKEND_URL}/api/events").mock(
        return_value=httpx.Response(201, json={"id": 1})
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})
    assert events.called  # disparou no label "vazamento", não no "aberto" global


@respx.mock
def test_cycle_raises_on_backend_error():
    # backend 500 vira HTTPError (raise_for_status), não JSONDecodeError opaco
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(return_value=httpx.Response(500))
    with httpx.Client() as client:
        try:
            monitor.cycle(client, "tok", {})
            raised = False
        except httpx.HTTPError:
            raised = True
    assert raised


@respx.mock
def test_heartbeat_posts_and_swallows_errors():
    ok = respx.post(f"{monitor.BACKEND_URL}/api/status/heartbeat").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    with httpx.Client() as client:
        monitor._heartbeat(client, "tok")
    assert ok.called

    class _Boom:  # backend fora → erro engolido (best-effort)
        def post(self, *a, **k):
            raise httpx.ConnectError("fora")

    monitor._heartbeat(_Boom(), "tok")  # não levanta


# ---- run() (loop) ----

def test_run_logs_cycle_error_then_exits(monkeypatch, capsys):
    # um ciclo que falha (backend caiu) é logado e o loop segue até o KeyboardInterrupt
    monkeypatch.setattr(monitor, "login", lambda client: "tok")
    monkeypatch.setattr(monitor, "_heartbeat", lambda c, t: None)

    def _boom(c, t, d):
        raise httpx.ConnectError("backend fora")

    monkeypatch.setattr(monitor, "cycle", _boom)
    monkeypatch.setattr(monitor.time, "sleep", lambda _s: (_ for _ in ()).throw(KeyboardInterrupt()))
    monitor.run()
    out = capsys.readouterr().out
    assert "backend indisponível" in out
    assert "encerrado" in out


def test_run_retries_login_when_backend_down(monkeypatch, capsys):
    # backend fora no boot → login levanta; não morre, tenta de novo no próximo ciclo
    calls = {"login": 0}

    def _login(client):
        calls["login"] += 1
        if calls["login"] == 1:
            raise httpx.ConnectError("connection refused")
        return "tok"

    monkeypatch.setattr(monitor, "login", _login)
    monkeypatch.setattr(monitor, "_heartbeat", lambda c, t: None)
    seen = {"cycles": 0}
    monkeypatch.setattr(monitor, "cycle", lambda c, t, d: seen.update(cycles=seen["cycles"] + 1))

    sleeps = {"n": 0}

    def _sleep(_s):
        sleeps["n"] += 1
        if sleeps["n"] >= 2:  # deixa rodar 2 iterações (falha + sucesso)
            raise KeyboardInterrupt

    monkeypatch.setattr(monitor.time, "sleep", _sleep)
    monitor.run()
    assert calls["login"] == 2  # relogou após a falha
    assert seen["cycles"] == 1  # só rodou ciclo depois do login dar certo


def test_run_loops_reusing_token_then_exits(monkeypatch, capsys):
    # 2 iterações: loga só 1x (reaproveita o token) e roda 2 ciclos
    logins = {"n": 0}
    monkeypatch.setattr(monitor, "login", lambda client: (logins.update(n=logins["n"] + 1), "tok")[1])
    monkeypatch.setattr(monitor, "_heartbeat", lambda c, t: None)
    seen = {"cycles": 0}
    monkeypatch.setattr(monitor, "cycle", lambda c, t, d: seen.update(cycles=seen["cycles"] + 1))

    sleeps = {"n": 0}

    def _sleep(_s):
        sleeps["n"] += 1
        if sleeps["n"] >= 2:
            raise KeyboardInterrupt

    monkeypatch.setattr(monitor.time, "sleep", _sleep)
    monitor.run()
    assert seen["cycles"] == 2
    assert logins["n"] == 1  # token reaproveitado na 2ª iteração
    assert "encerrado" in capsys.readouterr().out


# ---- Modo Vigilante: describe / post_observation / vigilante_cycle ----


def _fake_yolo_det(monkeypatch, cls_indices):
    class FakeBoxes:
        cls = cls_indices

    class FakeResult:
        boxes = FakeBoxes()
        names = {0: "person", 2: "car", 16: "dog", 3: "elephant"}

    class FakeYOLO:
        def __init__(self, w):
            pass

        def __call__(self, img):
            return [FakeResult()]

    mod = types.ModuleType("ultralytics")
    mod.YOLO = FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", mod)


def test_describe_lists_objects_in_pt(monkeypatch):
    _fake_yolo_det(monkeypatch, [0, 0, 16])
    text, objs = monitor.describe(_jpeg(), None)
    assert objs == ["person", "person", "dog"]
    assert "2 pessoas" in text and "1 cachorro" in text


def test_describe_with_crop_and_unknown_class(monkeypatch):
    _fake_yolo_det(monkeypatch, [3])  # 'elephant' não está no dicionário PT
    text, objs = monitor.describe(_jpeg(), {"x1": 0, "y1": 0, "x2": 10, "y2": 10})
    assert objs == ["elephant"] and "1 elephant" in text


def test_describe_empty_when_no_objects(monkeypatch):
    _fake_yolo_det(monkeypatch, [])
    assert monitor.describe(_jpeg(), None) == ("", [])


@respx.mock
def test_post_observation_posts_multipart():
    route = respx.post(f"{monitor.BACKEND_URL}/api/observations").mock(
        return_value=httpx.Response(201, json={"id": 1})
    )
    with httpx.Client() as client:
        monitor.post_observation(client, "tok", 1, "Detectado: 1 pessoa.", ["person"], b"jpeg")
    assert route.called


@respx.mock
def test_vigilante_disabled_does_nothing():
    respx.get(f"{monitor.BACKEND_URL}/api/observations/config").mock(
        return_value=httpx.Response(200, json={"enabled": False})
    )
    obs = respx.post(f"{monitor.BACKEND_URL}/api/observations").mock(
        return_value=httpx.Response(201, json={})
    )
    with httpx.Client() as client:
        monitor.vigilante_cycle(client, "tok", {1: "portao"})
    assert not obs.called


@respx.mock
def test_vigilante_enabled_posts_observation(monkeypatch):
    monkeypatch.setattr(monitor, "describe", lambda j, c: ("Detectado: 1 pessoa.", ["person"]))
    respx.get(f"{monitor.BACKEND_URL}/api/observations/config").mock(
        return_value=httpx.Response(200, json={"enabled": True})
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    obs = respx.post(f"{monitor.BACKEND_URL}/api/observations").mock(
        return_value=httpx.Response(201, json={"id": 1})
    )
    with httpx.Client() as client:
        monitor.vigilante_cycle(client, "tok", {1: "portao"})
    assert obs.called


@respx.mock
def test_vigilante_skips_empty_frame_and_no_objects(monkeypatch):
    monkeypatch.setattr(monitor, "describe", lambda j, c: ("", []))
    respx.get(f"{monitor.BACKEND_URL}/api/observations/config").mock(
        return_value=httpx.Response(200, json={"enabled": True})
    )
    # 1ª câmera: frame vazio (continue antes do describe); 2ª: frame ok mas sem objetos
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        side_effect=[httpx.Response(200, content=b""), httpx.Response(200, content=b"jpeg")]
    )
    obs = respx.post(f"{monitor.BACKEND_URL}/api/observations").mock(
        return_value=httpx.Response(201, json={})
    )
    with httpx.Client() as client:
        monitor.vigilante_cycle(client, "tok", {1: "vazia", 2: "cheia"})
    assert not obs.called


@respx.mock
def test_vigilante_handles_per_camera_error(monkeypatch, capsys):
    def boom(j, c):
        raise RuntimeError("falhou")

    monkeypatch.setattr(monitor, "describe", boom)
    respx.get(f"{monitor.BACKEND_URL}/api/observations/config").mock(
        return_value=httpx.Response(200, json={"enabled": True})
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    with httpx.Client() as client:
        monitor.vigilante_cycle(client, "tok", {1: "portao"})
    assert "vigilante" in capsys.readouterr().out


@respx.mock
def test_vigilante_config_error_returns_silently():
    respx.get(f"{monitor.BACKEND_URL}/api/observations/config").mock(
        side_effect=httpx.ConnectError("backend fora")
    )
    with httpx.Client() as client:
        monitor.vigilante_cycle(client, "tok", {1: "portao"})  # não levanta


# ---- zero-shot por descrições (CLIP) ----


class _ZsVec:
    def __init__(self, vals):
        self.vals = vals

    def argmax(self):
        return self.vals.index(max(self.vals))

    def __getitem__(self, i):
        return self.vals[i]


class _ZsLogits:
    def __init__(self, vals):
        self.vals = vals

    def softmax(self, dim):
        return [_ZsVec(self.vals)]


class _ZsFeat:
    def __init__(self, vals):
        self.vals = vals

    def norm(self, dim, keepdim):
        return 1

    def __truediv__(self, other):
        return self

    @property
    def T(self):
        return self

    def __rmul__(self, other):
        return self

    def __matmul__(self, other):
        return _ZsLogits(self.vals)


def _install_fake_clip(monkeypatch, image_vals=(0.3, 0.7), builds=None):
    import contextlib

    class FakeClip:
        def eval(self):
            pass

        def encode_text(self, tokens):
            return _ZsFeat([0.0] * len(tokens))

        def encode_image(self, tensor):
            return _ZsFeat(list(image_vals))

    def create(name, pretrained):
        if builds is not None:
            builds["n"] += 1

        class _Pre:
            def __call__(self, img):
                return self

            def unsqueeze(self, dim):
                return self

        return FakeClip(), None, _Pre()

    open_clip = types.ModuleType("open_clip")
    open_clip.create_model_and_transforms = create
    open_clip.get_tokenizer = lambda name: (lambda texts: texts)
    monkeypatch.setitem(sys.modules, "open_clip", open_clip)

    torch = types.ModuleType("torch")
    torch.no_grad = contextlib.nullcontext
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setattr(monitor, "_clip", None)
    monitor._text_feats.clear()


def test_zeroshot_picks_best_description(monkeypatch):
    _install_fake_clip(monkeypatch, image_vals=(0.3, 0.7))
    label, conf = monitor.zeroshot(
        _jpeg(), None, {"seco": "chão seco", "agua": "chão com água"}
    )
    assert (label, conf) == ("agua", 0.7)


def test_zeroshot_with_crop_and_cache(monkeypatch):
    builds = {"n": 0}
    _install_fake_clip(monkeypatch, image_vals=(0.9, 0.1), builds=builds)
    crop = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
    descr = {"aberto": "portão aberto", "fechado": "portão fechado"}
    label, _ = monitor.zeroshot(_jpeg(), crop, descr)
    assert label == "aberto"
    monitor.zeroshot(_jpeg(), crop, descr)  # cache de CLIP + features de texto
    assert builds["n"] == 1


@respx.mock
def test_cycle_zero_shot_fires_without_training(monkeypatch):
    """Modelo sem treino mas com descrições → classifica via zero-shot e dispara."""
    monkeypatch.setattr(monitor, "DEBOUNCE", 0)
    monkeypatch.setattr(monitor, "_trained", lambda mid: False)
    monkeypatch.setattr(monitor, "zeroshot", lambda j, c, d: ("aberto", 0.95))
    respx.get(f"{monitor.BACKEND_URL}/api/models").mock(
        return_value=httpx.Response(200, json=[{
            "id": 7, "camera_id": 1, "active": True, "crop": None,
            "descriptions": {"aberto": "portão aberto", "fechado": "portão fechado"},
            "alert_label": "aberto", "debounce_seconds": 0,
        }])
    )
    respx.get(f"{monitor.BACKEND_URL}/api/cameras").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "portao"}])
    )
    respx.get(f"{monitor.GO2RTC_URL}/api/frame.jpeg").mock(
        return_value=httpx.Response(200, content=b"jpeg")
    )
    respx.get(f"{monitor.BACKEND_URL}/api/observations/config").mock(
        return_value=httpx.Response(200, json={"enabled": False})
    )
    events = respx.post(f"{monitor.BACKEND_URL}/api/events").mock(
        return_value=httpx.Response(201, json={"id": 1})
    )
    with httpx.Client() as client:
        monitor.cycle(client, "tok", {})
    assert events.called
