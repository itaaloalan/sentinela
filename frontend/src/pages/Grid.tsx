import { useCallback, useEffect, useRef, useState } from "react";
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
// espelha o RECONNECT_TIMEOUT do video-rtc.js: um novo "playing" só reseta o
// "ativo desde" se o último frame estiver mais velho que isso (senão foi só
// um soluço curto de buffering, não uma reconexão de verdade).
const RECONNECT_TIMEOUT_MS = 15000;

function agoText(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
}

function activeForText(since: number | undefined, now: number): string {
  if (!since) return "—";
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  if (sec < 60) return `Ativo há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Ativo há ${min} min`;
  return `Ativo há ${Math.floor(min / 60)} h`;
}

function frameAgoText(ts: number | undefined, now: number): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return `último frame há ${sec}s`;
  return `último frame há ${Math.floor(sec / 60)} min`;
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
  // timestamp (Date.now()) de quando cada câmera começou a tocar; some ao
  // reconectar/perder o stream.
  const [playingSince, setPlayingSince] = useState<Map<number, number>>(new Map());
  // bump por câmera pra forçar remount do <CameraVideo> (botão Reconectar).
  const [streamKey, setStreamKey] = useState<Map<number, number>>(new Map());
  // timestamp do último frame renderizado por câmera; fica em ref (chega a
  // 4x/s) — quem força o re-render é o tick de 1s abaixo.
  const lastFrameRef = useRef<Map<number, number>>(new Map());
  const [, setTick] = useState(0);
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

  useEffect(() => {
    // atualiza os contadores "ativo há/último frame há" do rodapé dos cards.
    if (mode !== "grade" || cameras.length === 0) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [mode, cameras.length]);

  function markPlaying(id: number) {
    const now = Date.now();
    const lastFrame = lastFrameRef.current.get(id);
    const stale = !lastFrame || now - lastFrame > RECONNECT_TIMEOUT_MS;
    setPlayingSince((prev) => {
      // buffering curto (frame recente) não zera o "ativo desde"; só uma
      // reconexão de verdade (sem frame há mais de RECONNECT_TIMEOUT_MS) reseta.
      if (prev.has(id) && !stale) return prev;
      const next = new Map(prev);
      next.set(id, now);
      return next;
    });
  }

  function markFrame(id: number) {
    lastFrameRef.current.set(id, Date.now());
  }

  function reconnect(id: number) {
    setStreamKey((prev) => {
      const next = new Map(prev);
      next.set(id, (prev.get(id) ?? 0) + 1);
      return next;
    });
    setPlayingSince((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    lastFrameRef.current.delete(id);
  }

  function statusOf(cam: Camera) {
    // Online de verdade = go2rtc tem a câmera E o player está tocando aqui;
    // produtor ativo com player parado é "Conectando" (era enganoso antes).
    if (!overview) return { cls: "reconnecting", dot: "🟡", label: "Conectando" };
    const online = overview.cameras.find((c) => c.name === cam.name)?.online;
    if (!online) return { cls: "offline", dot: "🔴", label: "Offline" };
    return playingSince.has(cam.id)
      ? { cls: "online", dot: "🟢", label: "Online" }
      : { cls: "reconnecting", dot: "🟡", label: "Conectando" };
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
              const now = Date.now();
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
                      key={`${cam.id}:${streamKey.get(cam.id) ?? 0}`}
                      name={cam.name}
                      onPlaying={() => markPlaying(cam.id)}
                      onFrame={() => markFrame(cam.id)}
                    />
                  </div>
                  <div className="cam-foot">
                    <span>
                      {activeForText(playingSince.get(cam.id), now)} · {frameAgoText(lastFrameRef.current.get(cam.id), now)}
                    </span>
                    <button
                      className="ghost"
                      aria-label={`Reconectar ${cam.name}`}
                      onClick={() => reconnect(cam.id)}
                    >
                      ↻ Reconectar
                    </button>
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
                return <CameraVideo name={sel.name} />;
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
