import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  activateModel,
  captureFrame,
  createModel,
  deleteModel,
  deleteModelFrame,
  listCameras,
  listModels,
  listModelFrames,
  modelFrameUrl,
  setModelCrop,
  snapshotUrl,
  testModel,
  trainModel,
  updateModel,
  type AIModel,
  type Camera,
  type Crop,
  type TestResult,
} from "../lib/api";
import { CameraVideo } from "../components/CameraVideo";
import { CropEditor } from "../components/CropEditor";
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
  const [newClasses, setNewClasses] = useState("aberto, fechado");
  const [nameEdit, setNameEdit] = useState("");
  const [classesEdit, setClassesEdit] = useState("");
  const [descrEdit, setDescrEdit] = useState<Record<string, string>>({});
  const [alertLabel, setAlertLabel] = useState("");
  const [debounce, setDebounce] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
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
  // com 2+ descrições dá pra testar SEM treino (zero-shot pelas descrições)
  const canTest =
    trained || Object.keys(selected?.descriptions ?? {}).length >= 2;
  const training = selected?.status === "treinando";

  function loadFrames(id: number) {
    return run(async () => setFramesByLabel(await listModelFrames(id)));
  }

  function onSelect(model: AIModel) {
    setSelectedId(model.id);
    setNameEdit(model.name);
    setClassesEdit(model.classes.join(", "));
    setDescrEdit({ ...model.descriptions });
    setAlertLabel(model.alert_label);
    setDebounce(String(model.debounce_seconds));
    setTestResult(null);
    loadFrames(model.id);
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    return run(async () => {
      const classes = newClasses
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const created = await createModel(Number(newCameraId), newName, classes, classes[0]);
      await refresh();
      onSelect(created);
    });
  }

  function onRename() {
    return run(async () => {
      await updateModel(selected!.id, { name: nameEdit.trim() });
      await refresh();
    });
  }

  function onSaveAlert() {
    return run(async () => {
      await updateModel(selected!.id, {
        alert_label: alertLabel,
        debounce_seconds: Number(debounce),
      });
      await refresh();
    });
  }

  function onSaveDescriptions() {
    return run(async () => {
      await updateModel(selected!.id, { descriptions: descrEdit });
      await refresh();
    });
  }

  function onSaveClasses() {
    return run(async () => {
      const classes = classesEdit
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      const updated = await updateModel(selected!.id, { classes });
      await refresh();
      onSelect(updated);
    });
  }

  function onDelete() {
    return run(async () => {
      await deleteModel(selected!.id);
      setSelectedId(null);
      await refresh();
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

  function onSaveCrop(c: Crop) {
    return run(async () => {
      await setModelCrop(selected!.id, c);
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
    setTestResult(null);
    setTesting(true);
    return run(async () => setTestResult(await testModel(selected!.id))).finally(() =>
      setTesting(false),
    );
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
          <input
            aria-label="classes"
            placeholder="classes (ex.: aberto, fechado)"
            value={newClasses}
            onChange={(e) => setNewClasses(e.target.value)}
            required
          />
          <button>Criar modelo</button>
        </form>
        <p className="hint">
          As classes são os rótulos que a IA aprende (ex.: <code>aberto, fechado</code> ou{" "}
          <code>vazamento, seco</code>). A 1ª vira o gatilho do alerta — dá pra trocar depois.
        </p>

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
            <div className="cam-form">
              <input
                aria-label="nome do modelo"
                value={nameEdit}
                onChange={(e) => setNameEdit(e.target.value)}
              />
              <AsyncButton
                className="ghost"
                disabled={!nameEdit.trim() || nameEdit.trim() === selected.name}
                onClick={onRename}
              >
                Renomear
              </AsyncButton>
              <span className="spacer" />
              <AsyncButton className="ghost danger" onClick={onDelete}>
                🗑 Excluir modelo
              </AsyncButton>
            </div>

            <div className="cam-form">
              <input
                aria-label="classes do modelo"
                value={classesEdit}
                onChange={(e) => setClassesEdit(e.target.value)}
              />
              <AsyncButton
                className="ghost"
                disabled={classesEdit.trim() === selected.classes.join(", ")}
                onClick={onSaveClasses}
              >
                Salvar classes
              </AsyncButton>
              <span className="hint">
                rótulos que a IA aprende (ex.: <code>seco, agua</code>). Renomear move os
                frames já capturados.
              </span>
            </div>

            <div className="descr-block">
              <strong>📝 Descreva as classes (IA por texto)</strong>
              {selected.classes.map((c) => (
                <input
                  key={c}
                  aria-label={`descrição de ${c}`}
                  placeholder={`descreva '${c}' (ex.: portão de metal fechado, visto de frente)`}
                  value={descrEdit[c] ?? ""}
                  onChange={(e) => setDescrEdit((d) => ({ ...d, [c]: e.target.value }))}
                />
              ))}
              <AsyncButton className="ghost" onClick={onSaveDescriptions}>
                Salvar descrições
              </AsyncButton>
              <span className="hint">
                com 2+ descrições o modelo já funciona <strong>sem treino</strong> (compara a
                imagem com o texto). Quando houver treino com frames, o treino prevalece.
              </span>
            </div>
            {previewName && (
              <div className="cam-card">
                <div className="video contain">
                  <CameraVideo
                    key={selected.camera_id}
                    id={selected.camera_id}
                    name={previewName}
                  />
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
                      <img
                        src={modelFrameUrl(selected.id, label, file)}
                        alt={file}
                        onClick={() => setLightbox(modelFrameUrl(selected.id, label, file))}
                      />
                      <AsyncButton className="ghost" onClick={() => onDeleteFrame(label, file)}>
                        ✕
                      </AsyncButton>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {previewName && (
              <div className="crop-section">
                <h3>✂️ Recorte (foco da IA)</h3>
                <CropEditor
                  key={selected.id}
                  src={snapshotUrl(selected.camera_id)}
                  crop={selected.crop}
                  onSave={onSaveCrop}
                />
              </div>
            )}

            <div className="alert-config">
              <h3>🔔 Quando disparar o alerta</h3>
              <div className="cam-form">
                <label className="check">
                  ao detectar
                  <select
                    aria-label="classe de alerta"
                    value={alertLabel}
                    onChange={(e) => setAlertLabel(e.target.value)}
                  >
                    {selected.classes.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  por mais de
                  <input
                    type="number"
                    aria-label="segundos de espera"
                    min={0}
                    value={debounce}
                    onChange={(e) => setDebounce(e.target.value)}
                  />
                  s seguidos
                </label>
                <AsyncButton
                  className="ghost"
                  disabled={
                    alertLabel === selected.alert_label &&
                    Number(debounce) === selected.debounce_seconds
                  }
                  onClick={onSaveAlert}
                >
                  Salvar alerta
                </AsyncButton>
              </div>
              <p className="hint">
                Dispara quando a câmera mostrar <strong>{selected.alert_label}</strong> de
                forma contínua por <strong>{selected.debounce_seconds}s</strong> (confiança
                ≥ 80%) e o monitor estiver <strong>ativo</strong>. Abrir e fechar rápido
                (menos que isso) <strong>não</strong> notifica.
              </p>
            </div>

            <div className="status-line">
              <span className={`badge badge-${statusKind(selected.status)}`}>
                {selected.status}
              </span>
              {training && <span className="muted">treinando… (atualiza sozinho)</span>}
              {testing && <span className="muted">⏳ testando ao vivo…</span>}
              {selected.accuracy !== null && (
                <span className="muted">acurácia {Math.round(selected.accuracy * 100)}%</span>
              )}
              {testResult && (
                <span className="test-result">
                  resultado: {testResult.label ?? "?"}
                  {testResult.confidence !== null
                    ? ` (${Math.round(testResult.confidence * 100)}%)`
                    : ""}
                  {testResult.engine === "descricoes" && " · via descrições"}
                  {testResult.engine === "treino" && " · via treino"}
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
                <AsyncButton className="ghost" disabled={!canTest} onClick={onTest}>
                  2. Testar ao vivo
                </AsyncButton>
                <span className="hint">
                  {trained
                    ? "Classifica um frame agora"
                    : canTest
                      ? "Sem treino: testa pelas descrições (zero-shot)"
                      : "Treine OU descreva as classes primeiro"}
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
        {lightbox && (
          <div className="lightbox" role="dialog" onClick={() => setLightbox(null)}>
            <img src={lightbox} alt="captura ampliada" />
            <button className="ghost" aria-label="Fechar" onClick={() => setLightbox(null)}>
              ✕
            </button>
          </div>
        )}
      </main>
    </>
  );
}
