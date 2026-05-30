# IA "portão aberto" — classificador treinável na própria UI

## Objetivo

Dentro do Sentinela, ter uma área onde o Italo **cria um treinamento, treina fácil e testa** — um mini
*Teachable Machine* do portão. O resultado é um modelo que, rodando ao vivo, dispara notificação quando o
**portão fica aberto**.

## Por que classificação (e não detecção de objeto/movimento)

Um portão **aberto e parado** é exatamente o caso que zona/movimento erra (nada se mexe) e que um detector
genérico de "carro na zona" também erra. A pergunta certa é de **estado**: *"o portão está aberto AGORA?"* →
**classificador binário de imagem** `aberto` / `fechado`. É mais simples (não precisa bounding box, só pastas por
classe) e mais correto.

## Stack

- **Ultralytics YOLO classificação** (`yolo11n-cls.pt`) — transfer-learning, modelo minúsculo (~2-3M params),
  treina em **minutos na CPU**. Dataset = pastas por classe. Export ONNX/TFLite p/ inferência leve.
  ⚠️ Licença **AGPL-3.0** — ok para uso pessoal self-hosted; não distribuir o serviço a terceiros.
- (Inspiração: Frigate 0.17 *State Classification* usa MobileNetV2 + crop + debounce + threshold — mesmo conceito,
  porém treino na UI dele. Aqui o treino é na nossa UI.)

## Fluxo na web app

```
[Criar modelo] → [Capturar + rotular frames] → [Treinar (job)] → [Testar ao vivo] → [Ativar alerta]
                          ▲                                              │
                          └──────────── "errou? re-rotula" ◄────────────┘
```

1. **Criar modelo** — escolhe a câmera (a do portão), nome (`portao`), classes `aberto`/`fechado`.
2. **Capturar + rotular** — a UI puxa frames do go2rtc (`/api/frame.jpeg?src=<cam>`):
   - captura manual ("tirar foto agora") + captura automática a cada N s;
   - o usuário clica **aberto**/**fechado** em cada frame (galeria);
   - define o **crop** (retângulo só na folha do portão) arrastando na imagem — crop apertado = mais acurácia.
   - **Coletar em condições variadas**: dia, anoitecer, **noite/IR**, chuva, sol/sombra, com/sem carro.
     Este é o maior fator contra falso positivo. Meta inicial: ~100–200 frames por classe.
3. **Treinar** — botão dispara job em background:
   - backend monta `ai/data/<modelo>/{train,val}/{aberto,fechado}/*.jpg` (split ~80/20);
   - `yolo classify train data=ai/data/<modelo> model=yolo11n-cls.pt epochs=50-100 imgsz=224`;
   - reporta **progresso/accuracy** na UI (polling `GET /api/models/{id}/status` ou WebSocket);
   - salva `best.pt` + export ONNX + métricas; **versiona** o modelo.
4. **Testar** — roda o modelo no **frame ao vivo**, mostra predição + confiança em tempo real.
   "Está errado" → adiciona o frame à classe certa e re-treina (loop incremental).
5. **Ativar** — liga o **monitor**: 1 frame a cada ~5s → aplica crop → classifica → **debounce**
   (só conta como "aberto" se persistir por X s contínuos, ex. 30–60s; espelha a regra de 3 leituras iguais do
   Frigate + hold temporal) → cria **evento** (snapshot+timestamp) → dispara **ntfy**.

## API do backend (contrato)

| Método | Rota | Função |
|--------|------|--------|
| `POST` | `/api/models` | cria modelo (câmera, nome, classes) |
| `GET`  | `/api/models` | lista modelos + status/accuracy/ativo |
| `POST` | `/api/models/{id}/frames` | upload + rótulo de frame (multipart) |
| `GET`  | `/api/models/{id}/frames` | lista frames rotulados (galeria) |
| `PUT`  | `/api/models/{id}/crop` | define/atualiza o crop |
| `POST` | `/api/models/{id}/train` | enfileira job de treino |
| `GET`  | `/api/models/{id}/status` | progresso/accuracy do treino |
| `POST` | `/api/models/{id}/test` | infere num frame (ao vivo ou enviado) |
| `POST` | `/api/models/{id}/activate` | ativa/desativa o monitor |

## Serviço de IA (módulos)

- `ai/capture.py` — pega frames do go2rtc para rotulagem (chamado pela captura automática).
- `ai/trainer.py` — recebe um modelo, monta as pastas, roda `yolo classify train`, salva pesos + métricas.
- `ai/monitor.py` — loop de inferência por modelo ativo; aplica crop; classifica; debounce; emite evento.

Dados/pesos em `ai/data/<modelo>/` (gitignored). Metadados (classes, crop, versão, accuracy, ativo) no SQLite do
backend.

## Inferência (esboço)

```python
from ultralytics import YOLO
model = YOLO("ai/data/portao/weights/best.pt")          # ou .onnx
res = model(frame_cropped)                               # frame já com o crop aplicado
top1 = res[0].probs.top1
classe = res[0].names[top1]                              # "aberto" | "fechado"
conf  = float(res[0].probs.top1conf)
```

## Anti-falso-positivo (checklist)
- [ ] crop apertado só na folha do portão (excluir rua, céu, garagem)
- [ ] dataset com noite/IR, chuva, sol/sombra, com/sem carro
- [ ] debounce temporal (X s contínuos) além das 3 leituras iguais
- [ ] câmera com enquadramento **fixo** (PTZ/câmera que se mexe quebra o crop)
- [ ] threshold de confiança (ex. 0.8) configurável
- [ ] host com CPU **AVX2** (se um dia migrar p/ engine estilo Frigate)
