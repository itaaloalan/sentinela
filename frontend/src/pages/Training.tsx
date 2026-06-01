import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  activateModel,
  captureFrame,
  createModel,
  deleteModelFrame,
  listCameras,
  listModels,
  listModelFrames,
  modelFrameUrl,
  setModelCrop,
  testModel,
  trainModel,
  type AIModel,
  type Camera,
  type TestResult,
} from "../lib/api";
import { CameraVideo } from "../components/CameraVideo";
import { AsyncButton } from "../components/AsyncButton";

function statusKind(status: string): string {
  if (status === "pronto") return "ok";
  if (status === "treinando") return "wait";
  if (status.startsWith("erro")) return "err";
  return "new";
}

export default function Training() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [framesByLabel, setFramesByLabel] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("portao");
  const [newCameraId, setNewCameraId] = useState<number | "">("");
  const [crop, setCrop] = useState({ x1: "0", y1: "0", x2: "0", y2: "0" });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const nav = useNavigate();

  async function run(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }

  const refresh = useCallback(() => {
    return run(async () => {
      const [ms, cs] = await Promise.all([listModels(), listCameras()]);
      setModels(ms);
      setCameras(cs);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = models.find((m) => m.id === selectedId) ?? null;
  const previewName = cameras.find((c) => c.id === selected?.camera_id)?.name;

  // enquanto treina (job em background), atualiza sozinho até virar pronto/erro
  const trainingStatus = selected?.status;
  useEffect(() => {
    if (trainingStatus !== "treinando") return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [trainingStatus, refresh]);

  const totalFrames = selected
    ? Object.values(selected.frames).reduce((a, b) => a + b, 0)
    : 0;
  const trained = selected?.status === "pronto";
  const training = selected?.status === "treinando";

  function loadFrames(id: number) {
    return run(async () => setFramesByLabel(await listModelFrames(id)));
  }

  function onSelect(model: AIModel) {
    setSelectedId(model.id);
    setCrop({
      x1: String(model.crop?.x1 ?? 0),
      y1: String(model.crop?.y1 ?? 0),
      x2: String(model.crop?.x2 ?? 0),
      y2: String(model.crop?.y2 ?? 0),
    });
    loadFrames(model.id);
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    return run(async () => {
      const created = await createModel(Number(newCameraId), newName);
      await refresh();
      onSelect(created);
    });
  }

  function onCapture(label: string) {
    return run(async () => {
      await captureFrame(selected!.id, label);
      await loadFrames(selected!.id);
      await refresh();
    });
  }

  function onDeleteFrame(label: string, filename: string) {
    return run(async () => {
      await deleteModelFrame(selected!.id, label, filename);
      await loadFrames(selected!.id);
      await refresh();
    });
  }

  function onSaveCrop() {
    return run(async () => {
      await setModelCrop(selected!.id, {
        x1: Number(crop.x1),
        y1: Number(crop.y1),
        x2: Number(crop.x2),
        y2: Number(crop.y2),
      });
      await refresh();
    });
  }

  function onTrain() {
    return run(async () => {
      await trainModel(selected!.id);
      await refresh();
    });
  }

  function onTest() {
    return run(async () => setTestResult(await testModel(selected!.id)));
  }

  function onToggleActive() {
    return run(async () => {
      await activateModel(selected!.id, !selected!.active);
      await refresh();
    });
  }

  return (
    <>
      <header className="app-header">
        <button className="ghost" onClick={() => nav("/")}>← Câmeras</button>
        <h1>🧠 Treino da IA</h1>
      </header>
      <main>
        {error && <div className="error">{error}</div>}

        <form className="cam-form" onSubmit={onCreate}>
          <input
            placeholder="nome do modelo"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <select
            aria-label="câmera"
            value={newCameraId}
            onChange={(e) => setNewCameraId(e.target.value ? Number(e.target.value) : "")}
            required
          >
            <option value="">câmera…</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button>Criar modelo</button>
        </form>

        <div className="model-list">
          {models.map((m) => (
            <button
              key={m.id}
              className={m.id === selectedId ? "model-chip active" : "model-chip"}
              onClick={() => onSelect(m)}
            >
              {m.name} · {m.status}
              {m.active ? " · ativo" : ""}
            </button>
          ))}
        </div>

        {selected && (
          <section className="model-detail">
            <h2>{selected.name}</h2>
            {previewName && (
              <div className="cam-card">
                <div className="video">
                  <CameraVideo id={selected.camera_id} name={previewName} />
                </div>
              </div>
            )}

            <div className="capture-row">
              {selected.classes.map((label) => (
                <AsyncButton key={label} className="ghost" onClick={() => onCapture(label)}>
                  Capturar “{label}” ({selected.frames[label] ?? 0})
                </AsyncButton>
              ))}
            </div>

            {selected.classes.map((label) => (
              <div key={label} className="gallery">
                <h3>{label}</h3>
                <div className="thumbs">
                  {(framesByLabel[label] ?? []).map((file) => (
                    <div className="thumb" key={file}>
                      <img src={modelFrameUrl(selected.id, label, file)} alt={file} />
                      <AsyncButton className="ghost" onClick={() => onDeleteFrame(label, file)}>
                        ✕
                      </AsyncButton>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="cam-form">
              <span>Crop:</span>
              {(["x1", "y1", "x2", "y2"] as const).map((k) => (
                <input
                  key={k}
                  type="number"
                  aria-label={k}
                  value={crop[k]}
                  onChange={(e) => setCrop((c) => ({ ...c, [k]: e.target.value }))}
                />
              ))}
              <AsyncButton className="ghost" onClick={onSaveCrop}>Salvar crop</AsyncButton>
            </div>

            <div className="status-line">
              <span className={`badge badge-${statusKind(selected.status)}`}>
                {selected.status}
              </span>
              {training && <span className="muted">treinando… (atualiza sozinho)</span>}
              {selected.accuracy !== null && (
                <span className="muted">acurácia {Math.round(selected.accuracy * 100)}%</span>
              )}
              {testResult && (
                <span className="test-result">
                  resultado: {testResult.label ?? "?"}
                  {testResult.confidence !== null
                    ? ` (${Math.round(testResult.confidence * 100)}%)`
                    : ""}
                </span>
              )}
            </div>

            <div className="actions">
              <div className="action">
                <AsyncButton
                  className="primary"
                  disabled={totalFrames === 0 || training}
                  onClick={onTrain}
                >
                  1. Treinar
                </AsyncButton>
                <span className="hint">
                  {totalFrames === 0
                    ? "Capture frames das duas classes primeiro"
                    : `Treina o classificador com os ${totalFrames} frames`}
                </span>
              </div>
              <div className="action">
                <AsyncButton className="ghost" disabled={!trained} onClick={onTest}>
                  2. Testar ao vivo
                </AsyncButton>
                <span className="hint">
                  {trained ? "Classifica um frame agora" : "Treine o modelo primeiro"}
                </span>
              </div>
              <div className="action">
                <AsyncButton className="ghost" disabled={!trained} onClick={onToggleActive}>
                  {selected.active ? "Desativar alerta" : "3. Ativar alerta"}
                </AsyncButton>
                <span className="hint">
                  {selected.active
                    ? "Monitor ligado — avisa no celular quando abrir"
                    : trained
                      ? "Liga o monitor que dispara o alerta"
                      : "Treine o modelo primeiro"}
                </span>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
