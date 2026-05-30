"""Treino do classificador binário (aberto/fechado) com YOLO-cls.

Espera o dataset em ai/data/<modelo>/ no formato YOLO classify:
    data/<modelo>/train/aberto/*.jpg
    data/<modelo>/train/fechado/*.jpg
    data/<modelo>/val/aberto/*.jpg
    data/<modelo>/val/fechado/*.jpg

A UI dispara isto via backend (POST /api/models/{id}/train). Ver docs/AI-GATE.md.
"""
import pathlib

DATA_DIR = pathlib.Path(__file__).parent / "data"


def train_model(model_name: str, epochs: int = 50, imgsz: int = 224) -> dict:
    """Roda o treino e retorna métricas. Import do ultralytics é lazy (dep pesada)."""
    try:
        from ultralytics import YOLO
    except ImportError:
        raise RuntimeError(
            "ultralytics não instalado. Rode: pip install -r ai/requirements.txt"
        )

    dataset = DATA_DIR / model_name
    if not dataset.exists():
        raise FileNotFoundError(f"Dataset não encontrado: {dataset}")

    model = YOLO("yolo11n-cls.pt")  # nano pré-treinado (ImageNet)
    results = model.train(
        data=str(dataset),
        epochs=epochs,
        imgsz=imgsz,
        project=str(DATA_DIR / model_name),
        name="weights",
        exist_ok=True,
    )
    # exporta ONNX para inferência leve no monitor
    model.export(format="onnx")
    top1 = getattr(getattr(results, "results_dict", {}), "get", lambda *_: None)(
        "metrics/accuracy_top1"
    )
    return {"accuracy": top1, "weights": str(DATA_DIR / model_name / "weights")}


if __name__ == "__main__":
    print("Stub de treino. Forneça um dataset e chame train_model('portao').")
