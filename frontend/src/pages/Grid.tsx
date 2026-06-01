import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  auth,
  createCamera,
  deleteCamera,
  discoverCameras,
  listCameras,
  streamWsUrl,
  type Camera,
  type DiscoveredCamera,
} from "../lib/api";

const KINDS = ["rtsp", "dvrip", "onvif"];

// Vídeo ao vivo via WebRTC (web component <video-stream> do go2rtc).
// src/mode/background são propriedades, setadas via ref.
function CameraVideo({ name }: { name: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current as unknown as {
      mode: string;
      background: boolean;
      src: string;
    };
    el.mode = "webrtc,mse";
    el.background = false;
    el.src = streamWsUrl(name);
  }, [name]);
  return <video-stream ref={ref} className="cam-video" />;
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
  const [discovering, setDiscovering] = useState(false);
  const [found, setFound] = useState<DiscoveredCamera[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const nav = useNavigate();

  const refresh = useCallback(() => {
    return listCameras()
      .then(setCameras)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function logout() {
    auth.logout();
    nav("/login");
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // a senha digitada substitui o placeholder SENHA do source sugerido
      const finalSource = password ? source.split("SENHA").join(password) : source;
      await createCamera({ name, source: finalSource, kind, ptz_enabled: ptz });
      setName("");
      setSource("");
      setPassword("");
      setKind("rtsp");
      setPtz(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cadastrar");
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
        <button className="ghost" onClick={logout}>Sair</button>
      </header>
      <main>
        {error && <div className="error">{error}</div>}

        <form className="cam-form" onSubmit={onAdd}>
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
          <button disabled={busy}>{busy ? "Salvando…" : "Cadastrar câmera"}</button>
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

        {cameras.length === 0 && !error && (
          <div className="empty">Nenhuma câmera cadastrada ainda.</div>
        )}
        <div className="cam-grid">
          {cameras.map((cam) => (
            <div className="cam-card" key={cam.id}>
              <div className="video">
                <CameraVideo name={cam.name} />
              </div>
              <div className="label">
                {cam.name}
                <span className="spacer" />
                <button className="ghost" onClick={() => onDelete(cam.id)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
