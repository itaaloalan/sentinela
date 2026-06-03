"""Classificação zero-shot por descrições de classe (CLIP multilíngue).

A descrição em texto de cada classe ("portão de metal fechado", "chão com água
acumulada") vira o classificador: compara o frame com os textos e devolve a
classe mais parecida + confiança (softmax das similaridades). Permite que um
modelo SEM treino/frames já funcione só com as descrições.

Imports pesados (open_clip/torch/PIL) são lazy; o modelo CLIP e as features de
texto são cacheados (mesmo padrão do _model_cache de inference.py).
"""
import io

from .config import settings

_clip_cache: dict[str, tuple] = {}
_text_cache: dict[tuple, object] = {}


def _load_clip():
    """Carrega (1x) o CLIP configurado. ~1,1GB baixado no primeiro uso."""
    import open_clip  # lazy/pesado

    key = f"{settings.clip_model}/{settings.clip_pretrained}"
    cached = _clip_cache.get(key)
    if cached is not None:
        return cached
    model, _, preprocess = open_clip.create_model_and_transforms(
        settings.clip_model, pretrained=settings.clip_pretrained
    )
    tokenizer = open_clip.get_tokenizer(settings.clip_model)
    model.eval()
    loaded = (model, preprocess, tokenizer)
    _clip_cache[key] = loaded
    return loaded


def _text_features(texts: tuple[str, ...]):
    """Features de texto cacheadas por tupla de descrições (mudou → recalcula)."""
    import torch  # lazy

    cached = _text_cache.get(texts)
    if cached is not None:
        return cached
    model, _, tokenizer = _load_clip()
    with torch.no_grad():
        feats = model.encode_text(tokenizer(list(texts)))
        feats = feats / feats.norm(dim=-1, keepdim=True)
    _text_cache[texts] = feats
    return feats


def classify_text(
    jpeg: bytes, crop: dict | None, descriptions: dict[str, str]
) -> tuple[str, float]:
    """Classifica o frame contra as descrições → (label, confiança)."""
    from PIL import Image  # lazy

    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if crop is not None:
        img = img.crop((crop["x1"], crop["y1"], crop["x2"], crop["y2"]))

    import torch  # lazy

    labels = list(descriptions.keys())
    texts = tuple(descriptions[label] for label in labels)
    model, preprocess, _ = _load_clip()
    with torch.no_grad():
        image_feat = model.encode_image(preprocess(img).unsqueeze(0))
        image_feat = image_feat / image_feat.norm(dim=-1, keepdim=True)
        probs = (100.0 * image_feat @ _text_features(texts).T).softmax(dim=-1)[0]
    best = int(probs.argmax())
    return labels[best], float(probs[best])
