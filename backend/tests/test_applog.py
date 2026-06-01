import logging

from app import applog


def _clear_ring_handlers():
    root = logging.getLogger()
    for h in list(root.handlers):
        if isinstance(h, applog.RingHandler):
            root.removeHandler(h)


def test_ring_handler_records_into_recent():
    applog._BUFFER.clear()
    handler = applog.RingHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    handler.emit(logging.LogRecord("t", logging.INFO, "f.py", 1, "ola mundo", None, None))
    assert applog.recent()[-1] == "ola mundo"


def test_install_sets_info_when_unset_and_is_idempotent():
    _clear_ring_handlers()
    root = logging.getLogger()
    root.setLevel(logging.NOTSET)
    applog.install()
    assert root.level == logging.INFO
    count = sum(isinstance(h, applog.RingHandler) for h in root.handlers)
    applog.install()  # segunda vez não duplica
    assert sum(isinstance(h, applog.RingHandler) for h in root.handlers) == count == 1


def test_install_keeps_lower_level():
    _clear_ring_handlers()
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)  # já mais verboso que INFO → não sobe o nível
    applog.install()
    assert root.level == logging.DEBUG
