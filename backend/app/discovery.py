"""Descoberta de câmeras na LAN (para o botão "Descobrir" da UI).

Faz uma varredura TCP-connect (sem nmap, sem precisar de root) na /24 local,
identifica candidatos por porta aberta (DVRIP 34567 / RTSP 554), tenta resolver
o fabricante pelo OUI do MAC (ARP), e sugere um `source` pronto para o go2rtc.

A senha NÃO é descoberta: o `suggested_source` traz o placeholder `SENHA` para
o usuário substituir. Tudo aqui é injetável para permitir 100% de cobertura.
"""
import asyncio
import pathlib
import socket

# Portas que indicam uma câmera (e portas auxiliares para rotular).
SCAN_PORTS = [554, 34567, 8899, 5000, 80]
_OUI_PATH = "/usr/share/hwdata/oui.txt"
_ARP_PATH = "/proc/net/arp"
_ZERO_MAC = "00:00:00:00:00:00"


def local_subnet() -> str:
    """Retorna o prefixo /24 local (ex.: "192.168.0") via socket UDP."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
    finally:
        sock.close()
    return ip.rsplit(".", 1)[0]


async def probe_port(ip: str, port: int, timeout: float = 1.0) -> bool:
    """True se a porta TCP aceitar conexão dentro do timeout."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout
        )
    except (OSError, asyncio.TimeoutError):
        return False
    writer.close()
    return True


def arp_table(path: str = _ARP_PATH) -> dict[str, str]:
    """Mapa {ip: mac} a partir do cache ARP do kernel (best-effort)."""
    table: dict[str, str] = {}
    try:
        lines = pathlib.Path(path).read_text().splitlines()
    except OSError:
        return table
    for line in lines[1:]:  # pula o cabeçalho
        parts = line.split()
        if len(parts) >= 4 and parts[3] != _ZERO_MAC:
            table[parts[0]] = parts[3]
    return table


def vendor_for_mac(mac: str, oui_path: str = _OUI_PATH) -> str | None:
    """Fabricante a partir do OUI do MAC, se a base local existir."""
    prefix = mac.replace(":", "").upper()[:6]
    try:
        with open(oui_path, encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if line.startswith(prefix) and "(base 16)" in line:
                    return line.split("(base 16)")[1].strip()
    except OSError:
        return None
    return None


def classify(
    ip: str, open_ports: list[int], mac: str | None = None, vendor: str | None = None
) -> dict | None:
    """Transforma portas abertas num candidato com `source` sugerido (ou None)."""
    if 34567 in open_ports:
        kind = "dvrip"
        source = f"dvrip://admin:SENHA@{ip}:34567?channel=0&subtype=0"
        label = "DVRIP/Xiongmai (iCSee)"
    elif 554 in open_ports:
        kind = "rtsp"
        source = f"rtsp://admin:SENHA@{ip}:554/onvif1"
        label = "RTSP"
    else:
        return None
    return {
        "ip": ip,
        "mac": mac,
        "vendor": vendor,
        "ports": sorted(open_ports),
        "kind": kind,
        "suggested_source": source,
        "label": label,
    }


async def discover(timeout: float = 1.0, concurrency: int = 128) -> dict:
    """Varre a /24 local e devolve {subnet, candidates:[...]}."""
    base = local_subnet()
    sem = asyncio.Semaphore(concurrency)

    async def scan_host(n: int) -> tuple[str, list[int]]:
        ip = f"{base}.{n}"
        async with sem:
            results = await asyncio.gather(
                *(probe_port(ip, port, timeout) for port in SCAN_PORTS)
            )
        open_ports = [port for port, ok in zip(SCAN_PORTS, results) if ok]
        return ip, open_ports

    hosts = await asyncio.gather(*(scan_host(n) for n in range(1, 255)))
    arp = arp_table()

    candidates = []
    for ip, open_ports in hosts:
        mac = arp.get(ip)
        vendor = vendor_for_mac(mac) if mac else None
        cand = classify(ip, open_ports, mac, vendor)
        if cand:
            candidates.append(cand)

    candidates.sort(key=lambda c: tuple(int(x) for x in c["ip"].split(".")))
    return {"subnet": f"{base}.0/24", "candidates": candidates}
