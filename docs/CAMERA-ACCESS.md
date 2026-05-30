# Acesso às câmeras — receitas concretas (iCSee + Yoosee)

> **Este é o pré-requisito #1 do projeto.** Antes de codar qualquer UI, valide na bancada que as duas câmeras
> streamam. Especialmente a **Yoosee**, que aponta para o **portão** — o feature-estrela depende dela.

## Passo 0 — descobrir IP e portas

```bash
# Descobrir o IP da câmera no roteador (DHCP) ou:
nmap -sn 192.168.0.0/24                       # lista hosts ativos
# Escanear portas relevantes na câmera:
nmap -p 23,80,554,5000,8000,8899,34567,34569 <IP_CAMERA>
```

Portas que importam:
- **554** = RTSP
- **34567** = DVRIP/Sofia (iCSee/Xiongmai) — o protocolo que o app oficial usa
- **8899** = ONVIF (Xiongmai) — buggy, usar só p/ descoberta
- **5000** = ONVIF/PTZ (algumas Yoosee)
- **3702/udp** = WS-Discovery (ONVIF)

---

## 📷 iCSee (Xiongmai / Sofia / XMEye / DVRIP) — robusto

Esta câmera **sempre** pode ser acessada: o protocolo proprietário **DVRIP/Sofia na TCP 34567** é o que o app
usa, e funciona mesmo com RTSP/ONVIF desativados.

### Caminho preferido — `dvrip://` no go2rtc (recomendado)
```yaml
# go2rtc.yaml
streams:
  icsee:
    - dvrip://admin:SUA_SENHA@<IP>:34567?channel=0&subtype=0   # subtype 0=main, 1=sub
    # two-way audio (opcional): ...?backchannel=1
```
Vantagem: usa **credencial normal** (não o hash do RTSP). Só TCP.

### Caminho alternativo — RTSP (porta 554)
Testar as DUAS formas (varia por firmware — note os **underscores**):
```
rtsp://<IP>:554/user=admin_password=SUA_SENHA_channel=1_stream=0.sdp?real_stream
rtsp://admin:SUA_SENHA@<IP>:554/user=admin&password=SUA_SENHA&channel=1&stream=0.sdp?real_stream
```
Paths de fallback vistos em campo: `/onvif1` (main), `/onvif2` (sub), `/live/ch00_0`, `/h264_stream`, `/11`.
`channel` pode ser 0 ou 1; `stream`/`subtype` 0=main, 1=sub.

### Gotchas iCSee
- ⚠️ **Senha hasheada:** em muitos firmwares a senha no URL RTSP é um **hash Sofia de 8 chars**, não o texto puro.
  Se der 401/tela preta no RTSP, **use `dvrip://`** (credencial normal) ou pegue o URI exato via ONVIF
  `GetStreamUri` / `python-dvr`.
- **RTSP desativado de fábrica:** habilitar em web UI (porta 80) → NetService → RTSP, ou via `python-dvr`
  (`NetWork.RTSP`).
- **Credenciais padrão:** usuário `admin`, senha **em branco**. IP de fábrica `192.168.1.10`. Telnet (se aberto)
  root/`xmhdipc`.
- **Codec:** provavelmente **H.265** → transcodar p/ H.264 no go2rtc: `ffmpeg:dvrip://...#video=h264`.
- **ONVIF (8899) é buggy** — habilitar e usar p/ controle já causou boot-loop. Use só p/ descoberta/`GetStreamUri`.

### Libs/ferramentas de referência
- `go2rtc` (lista DVRIP como "DVR-IP NVR, NetSurveillance, Sofia protocol / XMeye SDK")
- `OpenIPC/python-dvr` (login, config, stream H.264/H.265, snapshot, habilitar RTSP/telnet)
- `667bdrm/sofiactl`
- Firmware alternativo (último caso, risco de brick): **OpenIPC / Thingino** (se o SoC for suportado)

---

## 📷 Yoosee (Gwell / Anyka AK3918 / PPPP) — aposta, validar por unidade

> ⚠️ É a câmera do **portão**. Resolver o stream dela é **caminho crítico**.

Yoosee **pode** falar RTSP/ONVIF padrão, mas há risco real de ser **P2P-cloud-only** (protocolo Gwell/IoTVideo),
sem stream LAN direto.

### Teste 1 (sem flashar) — habilitar RTSP no app
1. App **YooSee** → câmera → **Settings → Security/RTSP** (ou "NVR connection settings" / "Enable to connect")
   → **ligar RTSP e DEFINIR UMA SENHA** (não pode ficar em branco). Passo único; depois o app não é mais necessário.
2. Testar no VLC/ffmpeg (sub-stream primeiro — mais confiável):
   ```
   rtsp://admin:SUA_SENHA@<IP>:554/onvif2     # sub
   rtsp://admin:SUA_SENHA@<IP>:554/onvif1     # main (1080p/720p)
   ```
   Se falhar com erro de transporte: forçar `ffplay -rtsp_transport udp rtsp://...`.
   Auth costuma ser **Digest**, realm `HIipCamera`.
3. PTZ via ONVIF/SOAP: porta **5000**, endpoint `http://<IP>:5000/onvif/ptz_service`, profile `IPCProfilesToken0`.

Paths alternativos por rebrand: `/11`, `/0`, `/1`, `/live.sdp`,
`/user=admin&password=SUA_SENHA&channel=1&stream=0.sdp?`.
Credenciais padrão antes de definir a senha: `admin`/`admin`. IP de fábrica comum `192.168.1.188`.

Receita comunitária detalhada: **victorbillyph/Yoosee-camera-documentation**.

### Se a Yoosee for P2P-only (sem RTSP no menu) — opções em ordem de esforço
1. **DavidVentura/cam-reverse** (TS): bridge PPPP→MJPEG no browser **sem flashar**, *se* o chipset for da família
   suportada (X5/A9/TXW817). Pode precisar de port.
2. **MuhammedKalkan/Anyka-Camera-Firmware** (MIT): adiciona **servidor RTSP real** em câmeras **AK3918** (o SoC de
   boa parte das Yoosee). Modo **SD-card** é não-invasivo (baixo risco de brick). É o workaround prático, já que
   OpenIPC/Thingino **não** cobrem AK3918. Confirmar o SoC antes (`c0decave/yoosee-ipc` mostra root via UART e um
   daemon RTSP já na 554 em alguns modelos).
3. **Trocar a câmera do portão** por uma ONVIF/RTSP nativa (Reolink não-bateria, Amcrest/Dahua, Hikvision) —
   de longe o mais confiável se o objetivo é um produto estável. Ou **apontar a iCSee pro portão** e a Yoosee pra
   outra área.

### Decisão a tomar na PoC
- ✅ Yoosee abre RTSP/ONVIF → segue normal, go2rtc consome igual à iCSee.
- ❌ Yoosee P2P-only → escolher entre cam-reverse / flash AK3918 / trocar câmera **antes** de investir na UI de treino.

---

## Segurança (importante)
Essas câmeras têm histórico de CVEs (telnet root `xmhdipc`, leak de credencial ONVIF, command injection Sofia).
- Colocar as câmeras numa **VLAN/rede isolada**.
- Trocar a senha `admin` padrão.
- **Nunca** expor 34567/8899/554 à internet. Acesso remoto só via **Tailscale**.

## Checklist da PoC (fazer primeiro)
- [ ] `nmap` nas duas câmeras (anotar portas abertas)
- [ ] iCSee: `dvrip://` toca no go2rtc/VLC
- [ ] Yoosee: habilitar RTSP no app e testar `/onvif2` e `/onvif1`
- [ ] Confirmar codec (H.264 x H.265) de cada uma
- [ ] Identificar qual câmera tem **enquadramento fixo** no portão (necessário p/ o crop da IA)
- [ ] Decisão Yoosee registrada (OK x precisa workaround x trocar)
