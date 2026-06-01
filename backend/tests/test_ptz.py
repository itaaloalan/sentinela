import sys
import types

import pytest

from app import ptz
from app.db_models import Camera

CAM = Camera(name="portao", source="rtsp://admin:qwerty123@192.168.0.12:554/onvif1")


def test_conn_parses_source():
    host, user, password = ptz._conn(CAM.source)
    assert host == "192.168.0.12"
    assert user == "admin"
    assert password == "qwerty123"


class _Recorder:
    def __init__(self):
        self.calls = {}


def _install_fake_onvif(monkeypatch, rec):
    class FakeProfile:
        token = "tok0"

    class FakeMedia:
        def GetProfiles(self):
            return [FakeProfile()]

    class FakePtz:
        def Stop(self, arg):
            rec.calls["stop"] = arg

        def ContinuousMove(self, arg):
            rec.calls["move"] = arg

    class FakeONVIFCamera:
        def __init__(self, host, port, user, pwd):
            rec.calls["init"] = (host, port, user, pwd)

        def create_media_service(self):
            return FakeMedia()

        def create_ptz_service(self):
            return FakePtz()

    module = types.ModuleType("onvif")
    module.ONVIFCamera = FakeONVIFCamera
    monkeypatch.setitem(sys.modules, "onvif", module)


def test_move_continuous(monkeypatch):
    rec = _Recorder()
    _install_fake_onvif(monkeypatch, rec)
    ptz.move(CAM, 0.5, -0.2, 0.0)
    assert rec.calls["init"] == ("192.168.0.12", 5000, "admin", "qwerty123")
    assert rec.calls["move"]["Velocity"]["PanTilt"] == {"x": 0.5, "y": -0.2}
    assert "stop" not in rec.calls


def test_move_stop(monkeypatch):
    rec = _Recorder()
    _install_fake_onvif(monkeypatch, rec)
    ptz.move(CAM, 0.0, 0.0, 0.0)
    assert rec.calls["stop"]["ProfileToken"] == "tok0"
    assert "move" not in rec.calls


def test_move_without_onvif_installed(monkeypatch):
    monkeypatch.setitem(sys.modules, "onvif", None)
    with pytest.raises(RuntimeError, match="onvif-zeep"):
        ptz.move(CAM, 0.5, 0.0, 0.0)
