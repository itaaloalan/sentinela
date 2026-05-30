# Arquitetura — Sentinela

## Princípio

**Construir em cima de blocos prontos, não forkar um NVR inteiro.** O pedaço difícil (falar com câmeras
chinesas sem RTSP padrão) é resolvido por um único binário (**go2rtc**). O resto — UI, auth e o treino do
detector — é onde está o valor do projeto e onde queremos controle total.

## Diagrama

```
┌──────────────┐  dvrip:// :34567 (iCSee/Xiongmai)   ┌──────────┐
│   Câmeras    │ ─────────────────────────────────►  │          │
│  iCSee       │  rtsp:// :554 / onvif:// (Yoosee)    │  go2rtc  │
│  Yoosee      │ ─────────────────────────────────►  │ (engine) │
└──────────────┘                                     └────┬─────┘
                                                          │
              WebRTC/MSE (live ~0.5s) ┌───────────────────┼───────────────────┐ RTSP
                                      │                    │ /api/frame.jpeg    │
                                      ▼                    ▼                    ▼
                            ┌──────────────────┐  ┌─────────────────┐  ┌────────────────────┐
                            │  Frontend        │  │  Backend        │  │  Serviço de IA     │
                            │  React/Vite/PWA  │◄─┤  FastAPI        │  │  (YOLO-cls)        │
                            │  grid, auth,     │  │  auth, proxy,   │  │  trainer + monitor │
                            │  treino UI       │─►│  PTZ, eventos,  │◄─┤  frame→classe→evt  │
                            └──────────────────┘  │  ntfy           │  └────────────────────┘
                                    ▲             └────────┬────────┘
                                    │ PWA (UI)             │ push
                                    │                      ▼
                                    └──────────────  ntfy.sh ──►  📱 iPhone (via Tailscale)
```

## Peças

### go2rtc (streaming engine) — não editamos, só configuramos
- Binário Go zero-dependência (AlexxIT/go2rtc). Roda via Docker.
- **Entradas:** `dvrip://` (protocolo Sofia/Xiongmai da iCSee, TCP 34567 — funciona mesmo com RTSP desligado),
  `rtsp://` e `onvif://` (Yoosee, quando habilitado).
- **Saídas para o browser:** WebRTC (~0.5s na LAN), com fallback automático MSE e HLS; MJPEG; snapshot JPEG.
- **Transcode** H.265→H.264 quando o browser não aguenta HEVC (prefixo `ffmpeg:` na source).
- **API REST** (porta 1984) para CRUD de streams em runtime e `GET /api/frame.jpeg?src=cam`.
- ⚠️ **Sem auth nativa** — nunca expor a 1984 direto; o backend faz proxy autenticado.

### Backend — FastAPI (Python)
Responsabilidades:
1. **Auth simples** (login → JWT/cookie). Single-user no MVP.
2. **Proxy autenticado** para go2rtc (streams, snapshots, signaling WebRTC).
3. **PTZ** via cliente ONVIF direto na câmera (`POST /api/cameras/{id}/ptz`) — go2rtc **não** tem PTZ.
4. **Persistência** em SQLite + disco: usuários, câmeras, **modelos de IA**, **eventos** (snapshot+timestamp).
5. **API de treino** (ver `AI-GATE.md`): criar modelo, capturar/rotular frames, enfileirar treino, testar, ativar.
6. **Notificação** ntfy quando um modelo ativo detecta "portão aberto" (com debounce).

### Serviço de IA — Python + Ultralytics YOLO (classificação)
Dois modos:
- **trainer** (job em background): monta `data/<modelo>/{train,val}/{aberto,fechado}` → `yolo classify train` →
  salva `best.pt` (+ export ONNX) e métricas. Reporta progresso pro backend.
- **monitor** (loop por modelo ativo): pega 1 frame a cada ~5s do go2rtc, aplica o **crop** do portão,
  classifica, **debounce** (só dispara se `aberto` contínuo por X s), emite evento → backend → ntfy.

### Frontend — React + Vite + TypeScript, PWA
- Grid de câmeras usando o **web component `<video-stream>` do go2rtc** (player WebRTC/MSE pronto, reconexão,
  pause off-screen) — não escrevemos player de vídeo.
- Login, cadastro de câmeras, controles PTZ.
- **Fluxo de treino** (a feature-estrela): criar modelo → capturar+rotular frames → treinar → testar ao vivo → ativar.
- **PWA** (manifest + service worker) só para instalação/UI — **não** para push (Web Push é frágil no iOS).
- Mobile-first (a maioria do uso é no celular).

### Notificação + acesso remoto
- **ntfy.sh** (público) com tópico secreto longo → app ntfy no iPhone, entrega com tela bloqueada, snapshot inline.
- **Tailscale** (MagicDNS) serve a app no tailnet; o deep-link (`Click`) do ntfy aponta pra esse host.
- **Nunca** port-forward das câmeras; **não** usar Cloudflare Tunnel (termina TLS no edge + ToS restringe vídeo).

## Portas (dev)

| Serviço   | Porta | Obs |
|-----------|-------|-----|
| go2rtc    | 1984  | API/UI (interna — proxy pelo backend) |
| go2rtc    | 8554  | RTSP re-publicado |
| go2rtc    | 8555  | WebRTC TCP |
| backend   | 8000  | FastAPI |
| frontend  | 5173  | Vite dev server |

## Alternativas consideradas (e por que não)

- **Forkar um NVR (Frigate/Shinobi/ZoneMinder/VibeNVR):** dá UI grátis mas amarra ao modelo de config/eventos
  deles e à stack toda. Para um projeto sob medida com treino próprio, acopla demais. **Frigate vira referência,
  não base.**
- **Frigate como "cérebro" de IA:** a State Classification dele é exatamente o caso "portão aberto/fechado", mas
  o treino acontece na **UI do Frigate** — o Italo quer o treino **na nossa UI**. Fica como inspiração de
  UX/algoritmo (MobileNetV2, crop, debounce, threshold).
- **MediaMTX no lugar do go2rtc:** só se precisar de SRT/RTMP/gravação nativa em escala. go2rtc ganha pelo
  `<video-stream>` drop-in e pela source `dvrip://` nativa.
- **Web Push (PWA) para alertas:** frágil no iOS (perde subscription, exige PWA instalado). Usamos ntfy.

## Referências para ler (não forkar)
- Frigate — https://github.com/blakeblackshear/frigate (como consumir go2rtc no React, pipeline de eventos)
- Double Take — padrão "serviço de IA sobre eventos de câmera"
- onvif-web-viewer / go2rtc-split — exemplos de grid consumindo streams
