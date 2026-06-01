import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { eventSnapshotUrl, listEvents, type AlertEvent } from "../lib/api";

export default function Events() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    listEvents()
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, []);

  return (
    <>
      <header className="app-header">
        <button className="ghost" onClick={() => nav("/")}>← Câmeras</button>
        <h1>🔔 Eventos</h1>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {events.length === 0 && !error && (
          <div className="empty">Nenhum alerta ainda.</div>
        )}
        <div className="event-list">
          {events.map((ev) => (
            <div className="event-item" key={ev.id}>
              <img src={eventSnapshotUrl(ev.id)} alt={ev.label} />
              <div className="event-info">
                <strong>{ev.label}</strong>
                <span className="muted">{new Date(ev.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
