# Roadmap — Sentinela

Ordem de implementação. **Não pule a Fase 0** — o projeto inteiro depende dela.

## Fase 0 — PoC de acesso às câmeras (CRÍTICO, fazer primeiro) ⚠️

A câmera do **portão é a Yoosee** (a de acesso mais incerto). O feature-estrela só existe se ela streamar.

1. **Yoosee (crítico):** `nmap -p 554,5000,8899 <IP>` → habilitar RTSP no app YooSee → testar
   `rtsp://admin:SENHA@<IP>:554/onvif2` e `/onvif1` no VLC (`-rtsp_transport udp` se falhar).
   - ❌ Se P2P-only: decidir AQUI entre cam-reverse / flash AK3918 / trocar câmera (ver `CAMERA-ACCESS.md`).
2. **iCSee:** testar `dvrip://admin:SENHA@<IP>:34567?channel=0&subtype=0` no go2rtc/VLC.
3. Confirmar codec de cada câmera (H.264 x H.265) e qual tem **enquadramento fixo** no portão.

**Saída da fase:** as duas câmeras configuradas e tocando no go2rtc (`docker compose up go2rtc` → `localhost:1984`).

## Fase 1 — Streaming + grid (live view)
- Preencher `go2rtc/go2rtc.yaml` com as sources reais.
- Frontend: tela de grid usando `<video-stream>` do go2rtc (live WebRTC + snapshot).
- Backend: proxy autenticado pro go2rtc (não expor 1984).

## Fase 2 — Auth + cadastro de câmeras
- Backend: login (JWT/cookie), modelo `Camera` no SQLite, CRUD.
- go2rtc: adicionar/remover stream em runtime via REST quando uma câmera é cadastrada.
- Frontend: login, formulário de cadastro de câmera, persistência.

## Fase 3 — PTZ (onde a câmera suporta)
- Backend: cliente ONVIF (`onvif-zeep`), `POST /api/cameras/{id}/ptz` (pan/tilt/zoom, presets).
- Frontend: controles PTZ na visão da câmera.
- Nota: PTZ da Yoosee é via ONVIF porta 5000 e pode ser incompleto.

## Fase 4 — Feature de treino do portão (a estrela) 🧠
Implementar o fluxo de `AI-GATE.md`:
- Backend: API de modelos (criar, frames, crop, train, status, test, activate).
- IA: `capture.py`, `trainer.py` (job `yolo classify train`).
- Frontend: criar modelo → capturar+rotular (galeria + crop) → treinar (progresso) → testar ao vivo.

## Fase 5 — Monitor + alerta no iPhone
- IA: `monitor.py` (loop, crop, classificação, debounce).
- Backend: receber evento → salvar snapshot+timestamp (SQLite+disco) → disparar **ntfy** (tópico secreto,
  snapshot inline, `Click` deep-link).
- Frontend: histórico de eventos (timeline com snapshots).
- Configurar app **ntfy no iPhone** assinando o tópico.

## Fase 6 — Empacotar + acesso remoto
- `docker-compose.yml` completo (go2rtc + backend + frontend + ai).
- Servir via **Tailscale** (MagicDNS); apontar o `Click` do ntfy pro host do tailnet.
- PWA: manifest + service worker (instalação), revisar responsividade mobile.

## Backlog / ideias futuras
- Multi-usuário (hoje é single-user).
- Gravação/NVR (clipes dos eventos), retenção/rotação.
- Self-host do ntfy (privacidade) — lembrar do `upstream-base-url=https://ntfy.sh` p/ iOS.
- Outros tipos de alerta treinável (ex.: pessoa na porta, carro na vaga) reusando o mesmo fluxo de treino.
- Fallback de notificação por Telegram.

---

### Decisões já fechadas (não reabrir sem motivo)
- Stack: go2rtc + FastAPI + React/Vite PWA + serviço Python de IA. **Não forkar NVR.**
- IA: classificador binário YOLO-cls treinado **na nossa UI**. Frigate = referência.
- Câmera do portão = **Yoosee**.
- Notificação = **ntfy.sh** público (iPhone).
- Acesso remoto = **Tailscale**.
