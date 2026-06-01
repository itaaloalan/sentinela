from app import frames
from app.config import settings


def test_save_list_count(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    assert frames.list_frames(1, "aberto") == []  # diretório ainda não existe
    assert frames.count_frames(1, "aberto") == 0
    name = frames.save_frame(1, "aberto", b"jpegbytes")
    assert name.endswith(".jpg")
    assert frames.list_frames(1, "aberto") == [name]
    assert frames.count_frames(1, "aberto") == 1


def test_frame_path_safe_and_existing(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    name = frames.save_frame(2, "fechado", b"x")
    path = frames.frame_path(2, "fechado", name)
    assert path is not None and path.is_file()


def test_frame_path_rejects_unsafe_name(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    assert frames.frame_path(2, "fechado", "../secret") is None


def test_frame_path_missing_file(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    assert frames.frame_path(2, "fechado", "naoexiste.jpg") is None


def test_delete_frame(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ai_data_dir", str(tmp_path))
    name = frames.save_frame(3, "aberto", b"x")
    assert frames.delete_frame(3, "aberto", name) is True
    assert frames.delete_frame(3, "aberto", name) is False  # já removido
