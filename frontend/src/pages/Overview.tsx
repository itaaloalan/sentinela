import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  auth,
  getDaySummary,
  getOverview,
  listCameras,
  listEvents,
  type AlertEvent,
  type Camera,
  type DaySummary,
  type OverviewInfo,
} from "../lib/api";
import { ActionsMenu } from "../components/ActionsMenu";

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Tela inicial "Casa Segura": estado da casa num relance (câmeras online,
// alertas, último movimento) + resumo do dia por IA. Hub de navegação.
export default function Overview() {
  const [ov, setOv] = useState<OverviewInfo | null>(null);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    getOverview().then(setOv).catch(() => {});
    getDaySummary().then(setSummary).catch(() => {});
    listEvents().then(setEvents).catch(() => {});
    listCameras().then(setCameras).catch(() => {});
  }, []);

  function logout() {
    auth.logout();
    nav("/login");
  }

  const online = ov ? ov.cameras.filter((c) => c.online).length : 0;
  const total = ov ? ov.cameras.length : 0;
  const last = events[0];
  const lastCam = last
    ? cameras.find((c) => c.id === last.camera_id)?.name ?? `câmera #${last.camera_id}`
    : null;

  return (
    <>
      <header className="app-header">
        <h1>🏠 Casa Segura</h1>
        <span className="spacer" />
        <ActionsMenu>
          <button className="ghost" onClick={() => nav("/cameras")}>📹 Câmeras</button>
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
        <div className="overview-hero">
          <div className="stat big">
            <strong>{ov ? `${online}/${total}` : "—"}</strong>
            <span>câmeras online</span>
          </div>
          <div className="stat big">
            <strong>{ov ? ov.events_today : "—"}</strong>
            <span>alertas hoje</span>
          </div>
        </div>

        <div className="overview-last">
          {last ? (
            <>📍 Último movimento: <strong>{lastCam}</strong> — {hhmm(last.created_at)}</>
          ) : (
            "Nenhum movimento registrado hoje."
          )}
        </div>

        <section className="ai-resumo">
          <h2>🤖 Resumo de hoje</h2>
          <p>{summary ? summary.text : "Carregando resumo…"}</p>
        </section>

        <button className="see-cameras" onClick={() => nav("/cameras")}>Ver câmeras →</button>
      </main>
    </>
  );
}
