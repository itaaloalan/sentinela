"""Controle PTZ (pan/tilt/zoom) via ONVIF.

go2rtc não faz PTZ — falamos ONVIF direto na câmera (`onvif-zeep`). O import é
lazy (dependência pesada e opcional); credenciais/host saem da `source` da
câmera. Movimento contínuo: velocidades em [-1, 1]; tudo 0 = parar.
"""
from urllib.parse import urlparse

from .config import settings
from .db_models import Camera


def _conn(source: str) -> tuple[str | None, str | None, str | None]:
    u = urlparse(source)
    return u.hostname, u.username, u.password


def move(camera: Camera, pan: float, tilt: float, zoom: float) -> None:
    """Move (ou para, se pan=tilt=zoom=0) a câmera via ONVIF ContinuousMove."""
    try:
        from onvif import ONVIFCamera
    except ImportError:
        raise RuntimeError(
            "onvif-zeep não instalado. Rode: pip install -r requirements.txt"
        )

    host, user, password = _conn(camera.source)
    cam = ONVIFCamera(host, settings.onvif_port, user, password)
    media = cam.create_media_service()
    ptz = cam.create_ptz_service()
    token = media.GetProfiles()[0].token

    if pan == 0 and tilt == 0 and zoom == 0:
        ptz.Stop({"ProfileToken": token})
    else:
        ptz.ContinuousMove(
            {
                "ProfileToken": token,
                "Velocity": {
                    "PanTilt": {"x": pan, "y": tilt},
                    "Zoom": {"x": zoom},
                },
            }
        )
