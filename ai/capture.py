"""Captura de frames do go2rtc para rotulagem do dataset.

Usado pela captura automática da UI de treino. Salva JPEGs em
ai/data/<modelo>/<label>/ para depois virar dataset YOLO-cls.

Stub: a versão final é chamada pelo backend (Fase 4).
"""
import os
import pathlib
import time

import httpx

GO2RTC_URL = os.environ.get("GO2RTC_URL", "http://localhost:1984")
DATA_DIR = pathlib.Path(__file__).parent / "data"


def grab_frame(camera_name: str) -> bytes:
    """Pega um snapshot JPEG da câmera via go2rtc."""
    url = f"{GO2RTC_URL}/api/frame.jpeg?src={camera_name}"
    r = httpx.get(url, timeout=10)
    r.raise_for_status()
    return r.content


def save_frame(model_name: str, label: str, jpeg: bytes) -> pathlib.Path:
    out = DATA_DIR / model_name / label
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{int(time.time() * 1000)}.jpg"
    path.write_bytes(jpeg)
    return path


if __name__ == "__main__":
    print("Stub de captura. Implementar a captura automática na Fase 4 (ver docs/AI-GATE.md).")
