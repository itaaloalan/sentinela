import contextlib
import io
import sys
import types

from PIL import Image

from app import zeroshot


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, "JPEG")
    return buf.getvalue()


class _Vec:
    def __init__(self, vals):
        self.vals = vals

    def argmax(self):
        return self.vals.index(max(self.vals))

    def __getitem__(self, i):
        return self.vals[i]


class _Logits:
    def __init__(self, vals):
        self.vals = vals

    def softmax(self, dim):
        return [_Vec(self.vals)]


class _Feat:
    """Imita o suficiente de um tensor: norm/div/T/rmul/matmul."""

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
        return _Logits(self.vals)


def _install_fakes(monkeypatch, image_vals=(0.2, 0.8), builds=None):
    class FakeClip:
        def eval(self):
            pass

        def encode_text(self, tokens):
            return _Feat([0.0] * len(tokens))

        def encode_image(self, tensor):
            return _Feat(list(image_vals))

    def create_model_and_transforms(name, pretrained):
        if builds is not None:
            builds["n"] += 1

        class _Pre:
            def __call__(self, img):
                return self

            def unsqueeze(self, dim):
                return self

        return FakeClip(), None, _Pre()

    open_clip = types.ModuleType("open_clip")
    open_clip.create_model_and_transforms = create_model_and_transforms
    open_clip.get_tokenizer = lambda name: (lambda texts: texts)
    monkeypatch.setitem(sys.modules, "open_clip", open_clip)

    torch = types.ModuleType("torch")
    torch.no_grad = contextlib.nullcontext
    monkeypatch.setitem(sys.modules, "torch", torch)


def test_classify_text_picks_best_description(monkeypatch):
    zeroshot._clip_cache.clear()
    zeroshot._text_cache.clear()
    _install_fakes(monkeypatch, image_vals=(0.2, 0.8))
    label, conf = zeroshot.classify_text(
        _jpeg(), None, {"seco": "chão seco", "agua": "chão com água acumulada"}
    )
    assert (label, conf) == ("agua", 0.8)


def test_classify_text_with_crop_and_caches(monkeypatch):
    zeroshot._clip_cache.clear()
    zeroshot._text_cache.clear()
    builds = {"n": 0}
    _install_fakes(monkeypatch, image_vals=(0.9, 0.1), builds=builds)
    crop = {"x1": 0, "y1": 0, "x2": 10, "y2": 10}
    descr = {"aberto": "portão aberto", "fechado": "portão fechado"}
    label, _ = zeroshot.classify_text(_jpeg(), crop, descr)
    assert label == "aberto"
    # 2ª chamada: CLIP e features de texto vêm do cache (não recarrega)
    zeroshot.classify_text(_jpeg(), crop, descr)
    assert builds["n"] == 1
