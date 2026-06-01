import asyncio
from unittest.mock import Mock

from app import discovery


# ---- classify (função pura) ----

def test_classify_dvrip():
    cand = discovery.classify("192.168.0.66", [80, 554, 8899, 34567], "aa", "Xiongmai")
    assert cand["kind"] == "dvrip"
    assert cand["suggested_source"].startswith("dvrip://admin:SENHA@192.168.0.66:34567")
    assert cand["ports"] == [80, 554, 8899, 34567]
    assert cand["vendor"] == "Xiongmai"


def test_classify_rtsp():
    cand = discovery.classify("192.168.0.12", [554])
    assert cand["kind"] == "rtsp"
    assert cand["suggested_source"] == "rtsp://admin:SENHA@192.168.0.12:554/onvif1"
    assert cand["mac"] is None


def test_classify_not_a_camera():
    assert discovery.classify("192.168.0.5", [80, 6668]) is None


# ---- local_subnet ----

def test_local_subnet(monkeypatch):
    fake = Mock()
    fake.getsockname.return_value = ("192.168.0.2", 12345)
    monkeypatch.setattr(discovery.socket, "socket", lambda *a, **k: fake)
    assert discovery.local_subnet() == "192.168.0"
    fake.connect.assert_called_once()
    fake.close.assert_called_once()


# ---- probe_port ----

async def test_probe_port_open(monkeypatch):
    writer = Mock()

    async def fake_open(ip, port):
        return (Mock(), writer)

    monkeypatch.setattr(discovery.asyncio, "open_connection", fake_open)
    assert await discovery.probe_port("192.168.0.12", 554) is True
    writer.close.assert_called_once()


async def test_probe_port_closed(monkeypatch):
    async def fake_open(ip, port):
        raise OSError("connection refused")

    monkeypatch.setattr(discovery.asyncio, "open_connection", fake_open)
    assert await discovery.probe_port("192.168.0.13", 554) is False


# ---- arp_table ----

def test_arp_table_parses_valid_lines(tmp_path):
    arp = tmp_path / "arp"
    arp.write_text(
        "IP address       HW type     Flags       HW address            Mask     Device\n"
        "192.168.0.12     0x1         0x2         14:5d:34:ec:04:f9     *        eno1\n"
        "192.168.0.99     0x1         0x0         00:00:00:00:00:00     *        eno1\n"
        "short line\n"
    )
    table = discovery.arp_table(str(arp))
    assert table == {"192.168.0.12": "14:5d:34:ec:04:f9"}


def test_arp_table_missing_file_returns_empty():
    assert discovery.arp_table("/caminho/inexistente/arp") == {}


# ---- vendor_for_mac ----

def test_vendor_for_mac_found(tmp_path):
    oui = tmp_path / "oui.txt"
    oui.write_text(
        "48A4FD     (hex)\t\tAltoBeam Inc.\n"  # linha sem (base 16): ignorada
        "48A4FD     (base 16)\t\tAltoBeam Inc.\n"
        "C0F853     (base 16)\t\tTuya Smart Inc.\n"
    )
    assert discovery.vendor_for_mac("48:a4:fd:c3:ab:8c", str(oui)) == "AltoBeam Inc."


def test_vendor_for_mac_not_found(tmp_path):
    oui = tmp_path / "oui.txt"
    oui.write_text("C0F853     (base 16)\t\tTuya Smart Inc.\n")
    assert discovery.vendor_for_mac("14:5d:34:ec:04:f9", str(oui)) is None


def test_vendor_for_mac_missing_file():
    assert discovery.vendor_for_mac("48:a4:fd:c3:ab:8c", "/nao/existe.txt") is None


# ---- discover (orquestração) ----

async def test_discover_returns_sorted_candidates(monkeypatch):
    monkeypatch.setattr(discovery, "local_subnet", lambda: "192.168.0")

    async def fake_probe(ip, port, timeout=1.0):
        if ip == "192.168.0.66" and port == 34567:
            return True
        if ip == "192.168.0.12" and port == 554:
            return True
        return False

    monkeypatch.setattr(discovery, "probe_port", fake_probe)
    # .66 tem MAC no ARP (cobre o ramo vendor); .12 não tem (ramo vendor=None)
    monkeypatch.setattr(discovery, "arp_table", lambda: {"192.168.0.66": "48:a4:fd:c3:ab:8c"})
    monkeypatch.setattr(discovery, "vendor_for_mac", lambda mac: "AltoBeam Inc.")

    result = await discovery.discover(timeout=0.01)
    assert result["subnet"] == "192.168.0.0/24"
    assert result["scanned"] == 254
    ips = [c["ip"] for c in result["candidates"]]
    assert ips == ["192.168.0.12", "192.168.0.66"]  # ordenado por IP

    # diagnóstico: hosts com porta aberta (mesmo os classificados como câmera)
    reachable_ips = [h["ip"] for h in result["reachable"]]
    assert reachable_ips == ["192.168.0.12", "192.168.0.66"]
    assert result["reachable"][0]["ports"] == [554]

    rtsp = result["candidates"][0]
    dvrip = result["candidates"][1]
    assert rtsp["kind"] == "rtsp" and rtsp["vendor"] is None and rtsp["mac"] is None
    assert dvrip["kind"] == "dvrip" and dvrip["vendor"] == "AltoBeam Inc."
    assert dvrip["mac"] == "48:a4:fd:c3:ab:8c"
