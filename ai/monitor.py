"""Monitor de inferência ao vivo: detecta 'portão aberto' e dispara o evento.

Loop por modelo ativo: pega frame (go2rtc) -> crop -> classifica -> debounce
temporal -> POST /api/events no backend (que salva o snapshot e dispara o ntfy).

Imports pesados (ultralytics, PIL) são lazy. Funções puras (Debouncer/classify/
cycle) são testáveis isoladamente; `run()` é o loop de longa duração.
Ver docs/AI-GATE.md.
"""
from __future__ import annotations

import io
import os
import sys
import time

GO2RTC_URL = os.environ.get("GO2RTC_URL", "http://localhost:1984")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
ADMIN_USER = os.environ.get("SENTINELA_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("SENTINELA_ADMIN_PASS", "changeme")
AI_DATA_DIR = os.environ.get("AI_DATA_DIR", "./data")
ALERT_LABEL = os.environ.get("AI_ALERT_LABEL", "aberto")
INTERVAL = int(os.environ.get("AI_FRAME_INTERVAL_SECONDS", "5"))
DEBOUNCE = int(os.environ.get("AI_OPEN_DEBOUNCE_SECONDS", "45"))
THRESHOLD = float(os.environ.get("AI_CONFIDENCE_THRESHOLD", "0.8"))


class Debouncer:
    """Só dispara quando o rótulo de alerta persiste por `hold` segundos."""

    def __init__(self, alert_label: str, hold: float):
        self.alert_label = alert_label
        self.hold = hold
        self.since: float | None = None
        self.fired = False

    def update(self, label: str, now: float) -> bool:
        if label != self.alert_label:
            self.since = None
            self.fired = False
            return False
        if self.since is None:
            self.since = now
        if not self.fired and now - self.since >= self.hold:
            self.fired = True
            return True
        return False


def weights_path(model_id: int) -> str:
    return f"{AI_DATA_DIR}/{model_id}/run/weights/best.pt"


def _trained(model_id: int) -> bool:
    return os.path.exists(weights_path(model_id))


def classify(weights: str, jpeg: bytes, crop: dict | None) -> tuple[str, float]:
    from PIL import Image  # lazy

    img = Image.open(io.BytesIO(jpeg))
    if crop is not None:
        img = img.crop((crop["x1"], crop["y1"], crop["x2"], crop["y2"]))

    from ultralytics import YOLO  # lazy/pesado

    result = YOLO(weights)(img)[0]
    return result.names[result.probs.top1], float(result.probs.top1conf)


def login(client: httpx.Client) -> str:
    resp = client.post(
        f"{BACKEND_URL}/api/auth/login",
        data={"username": ADMIN_USER, "password": ADMIN_PASS},
    )
    return resp.json()["access_token"]


def post_event(client: httpx.Client, token: str, model_id: int, label: str, jpeg: bytes):
    client.post(
        f"{BACKEND_URL}/api/events",
        data={"model_id": model_id, "label": label},
        files={"file": ("snap.jpg", jpeg, "image/jpeg")},
        headers={"Authorization": f"Bearer {token}"},
    )


def _process_model(client, token, model, name_by_id, debouncers) -> None:
    if not model["active"]:
        return
    name = name_by_id.get(model["camera_id"])
    if name is None:
        return
    if not _trained(model["id"]):
        return  # ativo mas ainda sem treino concluído — ignora sem poluir o log
    jpeg = client.get(f"{GO2RTC_URL}/api/frame.jpeg?src={name}").content
    if not jpeg:
        raise RuntimeError(
            f"go2rtc não entregou frame de '{name}' — câmera offline/inacessível "
            "(VPN sequestrando a rota da LAN?)"
        )
    label, conf = classify(weights_path(model["id"]), jpeg, model["crop"])
    if conf < THRESHOLD:
        return
    # config por modelo (vinda do backend); cai no env se ausente (modelo antigo)
    alert = model.get("alert_label") or ALERT_LABEL
    hold = model.get("debounce_seconds")
    if hold is None:
        hold = DEBOUNCE
    deb = debouncers.setdefault(model["id"], Debouncer(alert, hold))
    deb.alert_label = alert  # reflete mudanças feitas na UI sem reiniciar
    deb.hold = hold
    if deb.update(label, time.time()):
        post_event(client, token, model["id"], label, jpeg)


def _get_json(client, url, headers):
    resp = client.get(url, headers=headers)
    resp.raise_for_status()  # 500/4xx vira HTTPError legível, não JSONDecodeError
    return resp.json()


def cycle(client: httpx.Client, token: str, debouncers: dict) -> None:
    """Uma varredura. Erro num modelo é logado e não derruba os demais/o loop."""
    headers = {"Authorization": f"Bearer {token}"}
    models = _get_json(client, f"{BACKEND_URL}/api/models", headers)
    cameras = _get_json(client, f"{BACKEND_URL}/api/cameras", headers)
    name_by_id = {c["id"]: c["name"] for c in cameras}

    for model in models:
        try:
            _process_model(client, token, model, name_by_id, debouncers)
        except Exception as exc:  # go2rtc fora, ultralytics ausente, etc.
            print(f"[sentinela-ai] erro no modelo {model.get('id')}: {exc}")


def run():
    import httpx

    print(f"[sentinela-ai] monitor: interval={INTERVAL}s debounce={DEBOUNCE}s")
    debouncers: dict = {}
    try:
        with httpx.Client(timeout=10) as client:
            token = login(client)
            while True:
                try:
                    cycle(client, token, debouncers)
                except httpx.HTTPError as exc:
                    # backend reiniciando / 500 / rede — loga e tenta no próximo ciclo
                    print(f"[sentinela-ai] ciclo falhou: {exc}")
                time.sleep(INTERVAL)
    except KeyboardInterrupt:
        print("\n[sentinela-ai] encerrado.")


if __name__ == "__main__":
    # auto-bootstrap: se chamado com outro Python (ex.: runner usando o python do
    # sistema), re-executa na venv do ai/ que tem as dependências (httpx, etc.).
    # NB: o python da venv costuma ser symlink p/ o do sistema, então comparar o
    # realpath do executável não distingue um do outro — sys.prefix sim (aponta
    # p/ a venv ativa quando rodando nela, p/ /usr quando no python do sistema).
    _venv = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv")
    _venv_py = os.path.join(_venv, "bin", "python")
    if os.path.exists(_venv_py) and os.path.realpath(sys.prefix) != os.path.realpath(_venv):
        os.execv(_venv_py, [_venv_py, *sys.argv])
    run()
