"""Monitor de inferência ao vivo: detecta 'portão aberto' e dispara o evento.

Loop por modelo ativo: pega frame (go2rtc) -> crop -> classifica -> debounce
temporal -> POST /api/events no backend (que salva o snapshot e dispara o ntfy).

Imports pesados (ultralytics, PIL) são lazy. Funções puras (Debouncer/classify/
cycle) são testáveis isoladamente; `run()` é o loop de longa duração.
Ver docs/AI-GATE.md.
"""
import io
import os
import time

import httpx

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


def cycle(client: httpx.Client, token: str, debouncers: dict) -> None:
    """Uma varredura: classifica cada modelo ativo e dispara evento se for o caso."""
    headers = {"Authorization": f"Bearer {token}"}
    models = client.get(f"{BACKEND_URL}/api/models", headers=headers).json()
    cameras = client.get(f"{BACKEND_URL}/api/cameras", headers=headers).json()
    name_by_id = {c["id"]: c["name"] for c in cameras}

    for model in models:
        if not model["active"]:
            continue
        name = name_by_id.get(model["camera_id"])
        if name is None:
            continue
        jpeg = client.get(f"{GO2RTC_URL}/api/frame.jpeg?src={name}").content
        label, conf = classify(weights_path(model["id"]), jpeg, model["crop"])
        if conf < THRESHOLD:
            continue
        deb = debouncers.setdefault(model["id"], Debouncer(ALERT_LABEL, DEBOUNCE))
        if deb.update(label, time.time()):
            post_event(client, token, model["id"], label, jpeg)


def run():
    print(f"[sentinela-ai] monitor: interval={INTERVAL}s debounce={DEBOUNCE}s")
    debouncers: dict = {}
    try:
        with httpx.Client(timeout=10) as client:
            token = login(client)
            while True:
                cycle(client, token, debouncers)
                time.sleep(INTERVAL)
    except KeyboardInterrupt:
        print("\n[sentinela-ai] encerrado.")


if __name__ == "__main__":
    run()
