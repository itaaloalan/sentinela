import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  auth,
  createCamera,
  deleteCamera,
  discoverCameras,
  getOverview,
  listCameras,
  listEvents,
  recordView,
  snapshotUrl,
  updateCamera,
  type AlertEvent,
  type Camera,
  type DiscoveredCamera,
  type OverviewInfo,
} from "../lib/api";
import { CameraVideo } from "../components/CameraVideo";
import { AsyncButton } from "../components/AsyncButton";
import { ActionsMenu } from "../components/ActionsMenu";

const KINDS = ["rtsp", "dvrip", "onvif"];

function agoText(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Grid() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState("rtsp");
  const [ptz, setPtz] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState<DiscoveredCamera[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [overview, setOverview] = useState<OverviewInfo | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [mode, setMode] = useState<"grade" | "monitor">("grade");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [playing, setPlaying] = useState<Set<number>>(new Set());
  const nav = useNavigate();

  const refresh = useCallback(() => {
    return listCameras()
      .then(setCameras)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, []);

  useEffect(() => {
    refresh();
    recordView(null).catch(() => {}); // registra acesso ao painel (histórico)
    getOverview().then(setOverview).catch(() => {});
    listEvents().then(setEvents).catch(() => {});
  }, [refresh]);

  function markPlaying(id: number) {
    setPlaying((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function statusOf(cam: Camera) {
    // Online de verdade = go2rtc tem a câmera E o player está tocando aqui;
    // produtor ativo com player parado é "Conectando" (era enganoso antes).
    if (!overview) return { cls: "reconnecting", dot: "🟡", label: "Conectando" };
    const online = overview.cameras.find((c) => c.name === cam.name)?.online;
    if (!online) return { cls: "offline", dot: "🔴", label: "Offline" };
    return playing.has(cam.id)
      ? { cls: "online", dot: "🟢", label: "Online" }
      : { cls: "reconnecting", dot: "🟡", label: "Conectando" };
  }

  function lastEventFor(cameraId: number): string {
    const ev = events.find((e) => e.camera_id === cameraId);
    return ev ? hhmm(ev.created_at) : "—";
  }

  function logout() {
    auth.logout();
    nav("/login");
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setSource("");
    setPassword("");
    setKind("rtsp");
    setPtz(false);
  }

  function onEdit(cam: Camera) {
    setMenuId(null);
    setShowForm(true);
    setEditingId(cam.id);
    setName(cam.name);
    setSource(cam.source);
    setPassword("");
    setKind(cam.kind);
    setPtz(cam.ptz_enabled);
    setError("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // a senha digitada substitui o placeholder SENHA do source sugerido
      const finalSource = password ? source.split("SENHA").join(password) : source;
      const payload = { name, source: finalSource, kind, ptz_enabled: ptz };
      if (editingId !== null) {
        await updateCamera(editingId, payload);
      } else {
        await createCamera(payload);
      }
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar a câmera");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    setError("");
    try {
      await deleteCamera(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir");
    }
  }

  async function onDiscover() {
    setDiscovering(true);
    setError("");
    setLog(["Procurando câmeras na rede…"]);
    try {
      const result = await discoverCameras();
      setFound(result.candidates);
      const lines = [
        `Sub-rede ${result.subnet}: ${result.scanned} IPs varridos.`,
        `${result.reachable.length} host(s) com porta aberta · ${result.candidates.length} câmera(s) identificada(s).`,
        ...result.reachable.map((h) => `• ${h.ip} — portas ${h.ports.join(", ")}`),
      ];
      if (result.candidates.length === 0) {
        lines.push(
          "Nenhuma câmera respondeu nas portas RTSP/DVRIP (554/34567). Verifique se o RTSP está ligado nas câmeras.",
        );
      }
      setLog(lines);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao descobrir";
      setError(msg);
      setLog((prev) => [...prev, `Erro: ${msg}`]);
    } finally {
      setDiscovering(false);
    }
  }

  function useCandidate(cam: DiscoveredCamera) {
    const octets = cam.ip.split(".");
    setName(octets[octets.length - 1]);
    setSource(cam.suggested_source);
    setKind(cam.kind);
  }

  return (
    <>
      <header className="app-header">
        <h1>🛡️ Sentinela</h1>
        <span className="spacer" />
        <ActionsMenu>
          <button className="ghost" onClick={() => nav("/")}>🏠 Início</button>
          <button className="ghost" onClick={() => setShowForm((s) => !s)}>➕ Adicionar câmera</button>
          <button className="ghost" onClick={() => nav("/treinos")}>🧠 Treinos</button>
          <button className="ghost" onClick={() => nav("/eventos")}>🔔 Eventos</button>
          <button className="ghost" onClick={() => nav("/resumo")}>📋 Resumo</button>
          <button className="ghost" onClick={() => nav("/vigilante")}>👁 Vigilante</button>
          <button className="ghost" onClick={() => nav("/familia")}>👨‍👩‍👧 Família</button>
          <button className="ghost" onClick={() => nav("/notificacoes")}>📲 Notificações</button>
          <button className="ghost" onClick={() => nav("/saude")}>❤️ Saúde</button>
          <button className="ghost" onClick={logout}>🚪 Sair</button>
        </ActionsMenu>
      </header>
      <main>
        {error && <div className="error">{error}</div>}

        {showForm && (
        <>
        <form className="cam-form" onSubmit={onSubmit}>
          <input
            placeholder="nome (ex.: portao)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoCapitalize="none"
            required
          />
          <input
            placeholder="source (rtsp://… ou dvrip://…)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="senha (substitui SENHA)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="tipo">
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <label className="check">
            <input
              type="checkbox"
              checked={ptz}
              onChange={(e) => setPtz(e.target.checked)}
            />
            PTZ
          </label>
          <button disabled={busy}>
            {busy ? "Salvando…" : editingId !== null ? "Salvar" : "Cadastrar câmera"}
          </button>
          {editingId !== null && (
            <button type="button" className="ghost" onClick={resetForm}>
              Cancelar
            </button>
          )}
          <button type="button" className="ghost" disabled={discovering} onClick={onDiscover}>
            {discovering ? "Procurando…" : "Descobrir"}
          </button>
        </form>

        {log.length > 0 && <pre className="discover-log">{log.join("\n")}</pre>}

        {found.length > 0 && (
          <div className="discover-list">
            {found.map((cam) => (
              <div className="discover-item" key={cam.ip}>
                <div className="discover-info">
                  <strong>{cam.label}</strong> — {cam.ip}
                  {cam.vendor && <span className="muted"> · {cam.vendor}</span>}
                  <span className="muted"> · portas {cam.ports.join(", ")}</span>
                </div>
                <button type="button" className="ghost" onClick={() => useCandidate(cam)}>
                  Usar
                </button>
              </div>
            ))}
          </div>
        )}
        </>
        )}

        {cameras.length === 0 && !error && (
          <div className="empty">Nenhuma câmera cadastrada ainda.</div>
        )}

        {cameras.length > 0 && (
          <>
            <div className="stats-bar">
              <div className="stat">
                <strong>{overview ? overview.cameras.filter((c) => c.online).length : "—"}/{cameras.length}</strong>
                <span>câmeras online</span>
              </div>
              <div className="stat">
                <strong>{overview ? overview.events_today : "—"}</strong>
                <span>eventos hoje</span>
              </div>
              <div className="stat">
                <strong>{events.length > 0 ? agoText(events[0].created_at) : "—"}</strong>
                <span>último movimento</span>
              </div>
              <div className="stat">
                <strong>{overview?.disk_percent != null ? `${overview.disk_percent}%` : "—"}</strong>
                <span>armazenamento</span>
              </div>
            </div>

            <div className="view-toggle">
              <button
                className={mode === "grade" ? "active" : "ghost"}
                onClick={() => setMode("grade")}
              >
                ▦ Grade
              </button>
              <button
                className={mode === "monitor" ? "active" : "ghost"}
                onClick={() => setMode("monitor")}
              >
                ▢ Monitoramento
              </button>
            </div>
          </>
        )}

        {mode === "grade" && (
          <div className="cam-grid">
            {cameras.map((cam) => {
              const st = statusOf(cam);
              return (
                <div className="cam-card" key={cam.id}>
                  <div className="cam-head">
                    <span className="cam-title">📷 {cam.name}</span>
                    <span className={`status-badge status-${st.cls}`}>{st.dot} {st.label}</span>
                    <button
                      className="dots"
                      aria-label={`Opções de ${cam.name}`}
                      onClick={() => setMenuId((id) => (id === cam.id ? null : cam.id))}
                    >
                      ⋯
                    </button>
                    {menuId === cam.id && (
                      <div className="card-menu">
                        <button className="ghost" onClick={() => onEdit(cam)}>Editar</button>
                        <AsyncButton className="ghost" onClick={() => onDelete(cam.id)}>Excluir</AsyncButton>
                      </div>
                    )}
                  </div>
                  <div className="video">
                    <CameraVideo
                      id={cam.id}
                      name={cam.name}
                      ptz={cam.ptz_enabled}
                      onPlaying={() => markPlaying(cam.id)}
                    />
                  </div>
                  <div className="cam-foot">
                    <span>📅 Último evento: {lastEventFor(cam.id)}</span>
                    <button className="ghost" onClick={() => nav("/eventos")}>🎥 Ver histórico</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {mode === "monitor" && cameras.length > 0 && (
          <div className="monitor">
            <div className="monitor-main">
              {(() => {
                const sel = cameras.find((c) => c.id === selectedId) ?? cameras[0];
                return <CameraVideo id={sel.id} name={sel.name} ptz={sel.ptz_enabled} />;
              })()}
            </div>
            <div className="monitor-strip">
              {cameras.map((cam) => (
                <button
                  key={cam.id}
                  className={`thumb${(selectedId ?? cameras[0].id) === cam.id ? " active" : ""}`}
                  onClick={() => setSelectedId(cam.id)}
                >
                  <img src={snapshotUrl(cam.id)} alt={cam.name} />
                  <span>{cam.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
