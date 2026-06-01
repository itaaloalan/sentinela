import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getHealth, type HealthInfo } from "../lib/api";

function fmtGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// Saúde do sistema: cartões de resumo (eventos, câmeras, disco, temperatura) +
// logs por serviço (clicar pra expandir e "ver o que está acontecendo").
export default function Health() {
  const [h, setH] = useState<HealthInfo | null>(null);
  const [error, setError] = useState("");
  const [openLog, setOpenLog] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    getHealth()
      .then(setH)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar"));
  }, []);

  function toggle(key: string) {
    setOpenLog((cur) => (cur === key ? null : key));
  }

  if (error) {
    return (
      <main>
        <div className="error">{error}</div>
      </main>
    );
  }
  if (!h) {
    return (
      <main>
        <div className="empty">Carregando saúde…</div>
      </main>
    );
  }

  const online = h.cameras.filter((c) => c.online).length;
  const aiAge =
    h.ai.last_seen_seconds != null ? ` (há ${Math.round(h.ai.last_seen_seconds)}s)` : "";
  const services = [
    { key: "go2rtc", label: "go2rtc (vídeo)", ok: h.go2rtc.reachable, log: h.go2rtc.log },
    { key: "backend", label: "Backend", ok: true, log: h.backend.log },
    { key: "ai", label: `IA ${h.ai.online ? "online" : "offline"}${aiAge}`, ok: h.ai.online, log: [] as string[] },
  ];

  return (
    <>
      <header className="app-header">
        <button className="ghost" onClick={() => nav("/")}>← Voltar</button>
        <h1>❤️ Saúde</h1>
      </header>
      <main>
        <div className="health-cards">
          <div className="health-card">
            <span>Eventos hoje</span>
            <strong>{h.events_today}</strong>
          </div>
          <div className="health-card">
            <span>Câmeras</span>
            <strong>{online}/{h.cameras.length} online</strong>
          </div>
          <div className="health-card">
            <span>Disco</span>
            <strong>{h.disk ? `${h.disk.percent}% · ${fmtGb(h.disk.free)} livre` : "—"}</strong>
          </div>
          <div className="health-card">
            <span>Temperatura</span>
            <strong>{h.temperature_c != null ? `${h.temperature_c} °C` : "—"}</strong>
          </div>
        </div>

        <h2>Câmeras</h2>
        <ul className="health-cams">
          {h.cameras.map((c) => (
            <li key={c.name}>{c.online ? "🟢" : "🔴"} {c.name}</li>
          ))}
        </ul>

        <h2>Logs dos serviços</h2>
        <div className="health-logs">
          {services.map((s) => (
            <div className="health-service" key={s.key}>
              <button
                type="button"
                className="ghost"
                onClick={() => toggle(s.key)}
                aria-expanded={openLog === s.key}
              >
                {s.ok ? "🟢" : "🔴"} {s.label}
              </button>
              {openLog === s.key &&
                (s.log.length > 0 ? (
                  <pre className="service-log">{s.log.join("\n")}</pre>
                ) : (
                  <p className="muted">Sem linhas de log.</p>
                ))}
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
