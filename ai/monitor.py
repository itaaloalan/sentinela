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


CLIP_MODEL = os.environ.get("CLIP_MODEL", "xlm-roberta-base-ViT-B-32")
CLIP_PRETRAINED = os.environ.get("CLIP_PRETRAINED", "laion5b_s13b_b90k")
_clip = None
_text_feats: dict[tuple, object] = {}


def _load_clip():
    """Carrega (1x) o CLIP multilíngue do zero-shot. ~1,1GB no primeiro uso."""
    global _clip
    if _clip is None:
        import open_clip  # lazy/pesado

        model, _, preprocess = open_clip.create_model_and_transforms(
            CLIP_MODEL, pretrained=CLIP_PRETRAINED
        )
        tokenizer = open_clip.get_tokenizer(CLIP_MODEL)
        model.eval()
        _clip = (model, preprocess, tokenizer)
    return _clip


def zeroshot(jpeg: bytes, crop: dict | None, descriptions: dict[str, str]) -> tuple[str, float]:
    """Classifica o frame contra as DESCRIÇÕES das classes (CLIP zero-shot).

    Permite monitorar um modelo sem treino: o texto de cada classe vira o
    classificador. Mesma lógica de app/zeroshot.py do backend (serviço à parte).
    """
    from PIL import Image  # lazy

    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if crop is not None:
        img = img.crop((crop["x1"], crop["y1"], crop["x2"], crop["y2"]))

    import torch  # lazy

    labels = list(descriptions.keys())
    texts = tuple(descriptions[label] for label in labels)
    model, preprocess, tokenizer = _load_clip()
    with torch.no_grad():
        feats = _text_feats.get(texts)
        if feats is None:
            feats = model.encode_text(tokenizer(list(texts)))
            feats = feats / feats.norm(dim=-1, keepdim=True)
            _text_feats[texts] = feats
        image_feat = model.encode_image(preprocess(img).unsqueeze(0))
        image_feat = image_feat / image_feat.norm(dim=-1, keepdim=True)
        probs = (100.0 * image_feat @ feats.T).softmax(dim=-1)[0]
    best = int(probs.argmax())
    return labels[best], float(probs[best])


def classify(weights: str, jpeg: bytes, crop: dict | None) -> tuple[str, float]:
    from PIL import Image  # lazy

    img = Image.open(io.BytesIO(jpeg))
    if crop is not None:
        img = img.crop((crop["x1"], crop["y1"], crop["x2"], crop["y2"]))

    from ultralytics import YOLO  # lazy/pesado

    result = YOLO(weights)(img)[0]
    return result.names[result.probs.top1], float(result.probs.top1conf)


_COCO_PT = {
    "person": "pessoa", "car": "carro", "motorcycle": "moto", "bicycle": "bicicleta",
    "bus": "ônibus", "truck": "caminhão", "dog": "cachorro", "cat": "gato",
    "bird": "pássaro", "backpack": "mochila", "umbrella": "guarda-chuva",
}


def describe(jpeg: bytes, crop: dict | None) -> tuple[str, list[str]]:
    """Descreve o frame por detecção de objetos (YOLO-det/COCO).

    Retorna (texto em PT, lista de classes detectadas). Sem objetos relevantes
    → texto vazio e lista vazia (o ciclo não registra observação). É o ponto de
    troca pra plugar um VLM (legenda rica) no futuro.
    """
    from PIL import Image  # lazy

    img = Image.open(io.BytesIO(jpeg))
    if crop is not None:
        img = img.crop((crop["x1"], crop["y1"], crop["x2"], crop["y2"]))

    from ultralytics import YOLO  # lazy/pesado

    result = YOLO("yolo11n.pt")(img)[0]
    names = result.names
    classes = [names[int(c)] for c in result.boxes.cls]
    if not classes:
        return "", []
    counts: dict[str, int] = {}
    for c in classes:
        counts[c] = counts.get(c, 0) + 1
    partes = [f"{n} {_COCO_PT.get(c, c)}" + ("s" if n > 1 else "") for c, n in counts.items()]
    return "Detectado: " + ", ".join(partes) + ".", classes


def post_observation(client, token: str, camera_id: int, description: str, objects: list[str], jpeg: bytes):
    client.post(
        f"{BACKEND_URL}/api/observations",
        data={"camera_id": camera_id, "description": description, "objects": ",".join(objects)},
        files={"file": ("obs.jpg", jpeg, "image/jpeg")},
        headers={"Authorization": f"Bearer {token}"},
    )


def vigilante_cycle(client, token: str, name_by_id: dict) -> None:
    """Se o Modo Vigilante estiver ligado, descreve cada câmera e registra."""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        enabled = _get_json(client, f"{BACKEND_URL}/api/observations/config", headers).get("enabled")
    except Exception:
        return  # best-effort: não sabe o estado → pula o vigilante neste ciclo
    if not enabled:
        return
    for camera_id, name in name_by_id.items():
        try:
            jpeg = client.get(f"{GO2RTC_URL}/api/frame.jpeg", params={"src": name}).content
            if not jpeg:
                continue
            text, objects = describe(jpeg, None)
            if text:
                post_observation(client, token, camera_id, text, objects, jpeg)
        except Exception as exc:  # câmera fora, ultralytics ausente, etc.
            print(f"[sentinela-ai] vigilante: erro em '{name}': {exc}")


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
    trained = _trained(model["id"])
    descriptions = model.get("descriptions") or {}
    if not trained and len(descriptions) < 2:
        return  # sem treino E sem descrições — nada com que classificar
    # params= encoda nomes com espaço/acento (f-string quebrava "Frente da casa")
    jpeg = client.get(f"{GO2RTC_URL}/api/frame.jpeg", params={"src": name}).content
    if not jpeg:
        raise RuntimeError(
            f"go2rtc não entregou frame de '{name}' — câmera offline/inacessível "
            "(VPN sequestrando a rota da LAN?)"
        )
    if trained:
        label, conf = classify(weights_path(model["id"]), jpeg, model["crop"])
    else:
        # zero-shot: as descrições das classes são o classificador
        label, conf = zeroshot(jpeg, model["crop"], descriptions)
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


def _heartbeat(client, token: str) -> None:
    """Sinaliza ao backend que o monitor está vivo (pra UI mostrar IA online)."""
    import httpx  # lazy: httpx não está no topo (bootstrap roda antes do import)

    try:
        client.post(
            f"{BACKEND_URL}/api/status/heartbeat",
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.HTTPError:
        pass  # best-effort: não atrapalha o ciclo se o backend oscilar


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

    vigilante_cycle(client, token, name_by_id)


def run():
    import httpx

    print(f"[sentinela-ai] monitor: interval={INTERVAL}s debounce={DEBOUNCE}s")
    debouncers: dict = {}
    try:
        with httpx.Client(timeout=10) as client:
            token: str | None = None
            while True:
                try:
                    if token is None:  # 1º boot ou após erro/expiração
                        token = login(client)
                    _heartbeat(client, token)
                    cycle(client, token, debouncers)
                except httpx.HTTPError as exc:
                    # backend fora/reiniciando, token expirado, 500 etc.: não morre,
                    # zera o token (força relogin) e tenta no próximo ciclo.
                    token = None
                    print(f"[sentinela-ai] backend indisponível, tentando de novo: {exc}")
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
