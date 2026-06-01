import pytest

import monitor


def test_classify_not_implemented():
    with pytest.raises(NotImplementedError):
        monitor.classify(model=None, frame_bytes=b"x")


def test_run_exits_on_keyboard_interrupt(monkeypatch, capsys):
    def _raise(_seconds):
        raise KeyboardInterrupt

    monkeypatch.setattr(monitor.time, "sleep", _raise)
    monitor.run()  # não deve propagar a exceção
    out = capsys.readouterr().out
    assert "monitor stub iniciado" in out
    assert "encerrado" in out
