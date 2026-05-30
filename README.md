# 🛡️ Sentinela

App web **self-hosted** para visualizar câmeras IP (iCSee + Yoosee) num só lugar, com um diferencial:
um **alerta treinável** que avisa no celular quando o **portão está aberto**.

> Substitui os apps proprietários (iCSee / Yoosee) por uma interface web única, responsiva (mobile-first),
> acessível de qualquer lugar via Tailscale — e com IA treinada por você, dentro do próprio sistema.

---

## ✨ O que ele faz

- 🔐 **Autenticação simples** (login).
- 📹 **Cadastrar e ver câmeras** ao vivo (baixa latência via WebRTC), com snapshot e — quando a câmera suporta — **PTZ**.
- 🧠 **Treino de alerta na própria UI**: crie um modelo "portão aberto/fechado", capture e rotule frames, **treine** e **teste ao vivo** — tudo pelo navegador (um mini *Teachable Machine* do seu portão).
- 🔔 **Notificação no iPhone** (via [ntfy](https://ntfy.sh)) com o snapshot do evento quando o portão fica aberto.
- 📱 **Mobile-first + PWA** (instalável na tela inicial) — mesmo código serve celular e desktop.
- 🌐 **Acesso remoto via Tailscale**, sem expor porta na internet.

## 🏗️ Arquitetura (resumo)

```
Câmeras ──dvrip:// (iCSee) / rtsp:// (Yoosee)──> go2rtc ──WebRTC/MSE──> Frontend React/PWA
                                                   │  RTSP                    │
                                                   ▼                          │ push (ntfy)
                                           Serviço de IA (YOLO-cls)           ▼
                                           frame→classifica→evento  ── Backend FastAPI ──> iPhone
                                                                    (auth, proxy, PTZ, eventos)
```

- **[go2rtc](https://github.com/AlexxIT/go2rtc)** — engine de streaming. Fala o protocolo proprietário da iCSee (`dvrip://`, porta 34567) e RTSP/ONVIF da Yoosee, e re-publica streams que o browser toca (WebRTC ~0.5s).
- **Backend (FastAPI)** — auth, proxy autenticado pro go2rtc, PTZ via ONVIF, persistência (SQLite), API de treino, disparo de notificação.
- **Serviço de IA (Python + Ultralytics YOLO-cls)** — treina e roda o classificador binário do portão.
- **Frontend (React + Vite + TS, PWA)** — grid de câmeras, auth, e o fluxo de treino.

Detalhes completos em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 🚀 Quickstart (dev)

> Pré-requisitos: Docker, Python 3.11+, Node 20+.

```bash
# 1. Streaming engine (configure suas câmeras em go2rtc/go2rtc.yaml antes)
docker compose up -d go2rtc        # UI/API em http://localhost:1984

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env             # ajuste as variáveis
uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health

# 3. Frontend
cd ../frontend
npm install
npm run dev                          # http://localhost:5173
```

No **claude-workspaces** os runners `go2rtc`, `backend` e `frontend` já estão configurados — é só dar play.

## ⚠️ Antes de tudo: validar acesso às câmeras

O maior risco do projeto é o acesso ao stream das câmeras (principalmente a **Yoosee**, que aponta para o portão).
**Faça a PoC de bancada antes de construir UI** — veja [`docs/CAMERA-ACCESS.md`](docs/CAMERA-ACCESS.md).

## 📚 Documentação

| Doc | Conteúdo |
|-----|----------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Diagrama, papel de cada peça, decisões e alternativas |
| [`docs/CAMERA-ACCESS.md`](docs/CAMERA-ACCESS.md) | Receitas concretas de stream iCSee/Yoosee (URLs, portas, gotchas) |
| [`docs/AI-GATE.md`](docs/AI-GATE.md) | Plano do classificador "portão aberto" e do fluxo de treino na UI |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Fases de implementação (em ordem) |

## 📦 Estado atual

Esqueleto rodável + documentação. A implementação profunda (PoC de câmera, UI completa, treino do modelo)
segue as fases do [ROADMAP](docs/ROADMAP.md).

## 📄 Licença

Projeto pessoal. Atenção: a dependência **Ultralytics** (YOLO) é **AGPL-3.0** — ok para uso pessoal self-hosted.
