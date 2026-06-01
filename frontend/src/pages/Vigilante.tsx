import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getVigilanteConfig,
  listObservations,
  observationSnapshotUrl,
  setVigilante,
  type Observation,
} from "../lib/api";

// Modo Vigilante: liga/desliga as descrições contínuas e lista o que a IA viu.
export default function Vigilante() {
  const [enabled, setEnabled] = useState(false);
  const [obs, setObs] = useState<Observation[]>([]);
  const [error, setError] = useState("");
  const nav = useNavigate();

  const refresh = useCallback(() => {
    return listObservations()
      .then(setObs)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar"));
  }, []);

  useEffect(() => {
    getVigilanteConfig()
      .then((c) => setEnabled(c.enabled))
      .catch(() => setEnabled(false));
    refresh();
  }, [refresh]);

  async function toggle() {
    setError("");
    try {
      const c = await setVigilante(!enabled);
      setEnabled(c.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao alternar");
    }
  }

  function hora(iso: string) {
    return new Date(iso).toLocaleString();
  }

  return (
    <>
      <header className="app-header">
        <button className="ghost" onClick={() => nav("/")}>← Voltar</button>
        <h1>👁 Modo Vigilante</h1>
      </header>
      <main>
        {error && <div className="error">{error}</div>}

        <div className="vigilante-toggle">
          <span>{enabled ? "🟢 Ligado — a IA observa e descreve" : "⚪ Desligado"}</span>
          <button onClick={toggle}>{enabled ? "Desligar" : "Ligar"}</button>
        </div>

        {obs.length === 0 ? (
          <div className="empty">Nenhuma observação ainda.</div>
        ) : (
          <ul className="obs-list">
            {obs.map((o) => (
              <li className="obs-item" key={o.id}>
                {o.snapshot && (
                  <img src={observationSnapshotUrl(o.id)} alt={o.description} className="obs-thumb" />
                )}
                <div>
                  <div className="obs-desc">{o.description}</div>
                  <div className="muted obs-time">{hora(o.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
