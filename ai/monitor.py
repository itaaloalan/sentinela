"""Monitor de inferência ao vivo: detecta 'portão aberto' e dispara o evento.

Loop por modelo ativo:
  pega frame (go2rtc) -> aplica crop -> classifica -> debounce -> emite evento -> backend/ntfy

Stub do skeleton: roda em modo idle se faltar dep/modelo. Implementação completa na Fase 5.
Ver docs/AI-GATE.md.
"""
import os
import time

FRAME_INTERVAL = int(os.environ.get("AI_FRAME_INTERVAL_SECONDS", "5"))
DEBOUNCE = int(os.environ.get("AI_OPEN_DEBOUNCE_SECONDS", "45"))
THRESHOLD = float(os.environ.get("AI_CONFIDENCE_THRESHOLD", "0.8"))


def classify(model, frame_bytes: bytes):
    """Retorna (label, confidence). Esboço — completar na Fase 5."""
    # from ultralytics import YOLO ; res = model(img_cropped) ...
    raise NotImplementedError


def run():
    print(
        "[sentinela-ai] monitor stub iniciado.\n"
        f"  interval={FRAME_INTERVAL}s debounce={DEBOUNCE}s threshold={THRESHOLD}\n"
        "  Sem modelos ativos / deps de IA: rodando idle.\n"
        "  Implementar o loop de inferência na Fase 5 (ver docs/AI-GATE.md). Ctrl+C p/ sair."
    )
    try:
        while True:
            # TODO: para cada modelo ativo -> grab_frame -> crop -> classify -> debounce -> evento
            time.sleep(FRAME_INTERVAL)
    except KeyboardInterrupt:
        print("\n[sentinela-ai] encerrado.")


if __name__ == "__main__":
    run()
