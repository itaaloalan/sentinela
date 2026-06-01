import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { askSummary, getDaySummary, type DaySummary } from "../lib/api";

// Resumo do dia + perguntas em linguagem natural sobre os eventos.
export default function Summary() {
  const [s, setS] = useState<DaySummary | null>(null);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    getDaySummary()
      .then(setS)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar"));
  }, []);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    setAsking(true);
    try {
      const res = await askSummary(question);
      setAnswer(res.answer);
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "Erro ao perguntar");
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <header className="app-header">
        <button className="ghost" onClick={() => nav("/")}>← Voltar</button>
        <h1>📋 Resumo do dia</h1>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {!error && !s && <div className="empty">Carregando resumo…</div>}
        {s && (
          <>
            <p className="summary-text">{s.text}</p>
            {s.total > 0 && (
              <div className="summary-breakdown">
                <ul>
                  {s.by_label.map((b) => (
                    <li key={b.label}>{b.count}× {b.label}</li>
                  ))}
                </ul>
                <ul>
                  {s.by_camera.map((b) => (
                    <li key={b.camera}>📷 {b.camera}: {b.count}</li>
                  ))}
                </ul>
              </div>
            )}

            <form className="summary-ask" onSubmit={onAsk}>
              <input
                placeholder="Pergunte: quando? quantos? qual câmera?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                aria-label="pergunta"
                required
              />
              <button disabled={asking}>{asking ? "Pensando…" : "Perguntar"}</button>
            </form>
            {answer && <p className="summary-answer">💬 {answer}</p>}
          </>
        )}
      </main>
    </>
  );
}
