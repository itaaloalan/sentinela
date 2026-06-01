import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  auth,
  createUser,
  deleteUser,
  listUsers,
  listViews,
  sendEmergency,
  type FamilyUser,
  type ViewLog,
} from "../lib/api";
import { AsyncButton } from "../components/AsyncButton";

// Recursos para família: botão de emergência (todos), gestão de perfis e
// histórico de visualização (apenas admin).
export default function Family() {
  const [users, setUsers] = useState<FamilyUser[]>([]);
  const [views, setViews] = useState<ViewLog[]>([]);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("familiar");
  const [armed, setArmed] = useState(false);
  const [emergencyMsg, setEmergencyMsg] = useState("");
  const nav = useNavigate();
  const isAdmin = auth.isAdmin;

  const refresh = useCallback(() => {
    if (!isAdmin) return;
    listUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
    listViews()
      .then(setViews)
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await createUser(username, password, role);
      setUsername("");
      setPassword("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar usuário");
    }
  }

  async function onDelete(id: number) {
    setError("");
    try {
      await deleteUser(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir");
    }
  }

  async function fireEmergency() {
    setArmed(false);
    try {
      await sendEmergency();
      setEmergencyMsg("🆘 Alerta de emergência enviado!");
    } catch (err) {
      setEmergencyMsg(err instanceof Error ? err.message : "Falha ao enviar");
    }
  }

  return (
    <>
      <header className="app-header">
        <button className="ghost" onClick={() => nav("/")}>← Voltar</button>
        <h1>👨‍👩‍👧 Família</h1>
      </header>
      <main>
        {error && <div className="error">{error}</div>}

        <section className="emergency-box">
          <h2>Botão de emergência</h2>
          <p className="muted">Dispara um alerta urgente para todos os canais (ntfy/Discord).</p>
          {!armed ? (
            <button className="emergency-btn" onClick={() => setArmed(true)}>🆘 Emergência</button>
          ) : (
            <div className="emergency-confirm">
              <span>Confirmar envio?</span>
              <button className="emergency-btn" onClick={fireEmergency}>Enviar agora</button>
              <button className="ghost" onClick={() => setArmed(false)}>Cancelar</button>
            </div>
          )}
          {emergencyMsg && <p className="summary-answer">{emergencyMsg}</p>}
        </section>

        {!isAdmin ? (
          <p className="muted">Gestão de perfis e histórico são exclusivos do administrador.</p>
        ) : (
          <>
            <section>
              <h2>Perfis de acesso</h2>
              <form className="cam-form" onSubmit={onCreate}>
                <input
                  placeholder="usuário"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="none"
                  required
                />
                <input
                  type="password"
                  placeholder="senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="papel">
                  <option value="familiar">familiar</option>
                  <option value="admin">admin</option>
                </select>
                <button>Adicionar pessoa</button>
              </form>
              <ul className="user-list">
                {users.map((u) => (
                  <li key={u.id}>
                    <span>{u.role === "admin" ? "👑" : "👤"} {u.username} <span className="muted">({u.role})</span></span>
                    <AsyncButton className="ghost" onClick={() => onDelete(u.id)}>Excluir</AsyncButton>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2>Quem viu as câmeras</h2>
              {views.length === 0 ? (
                <p className="muted">Nenhum acesso registrado ainda.</p>
              ) : (
                <ul className="view-log">
                  {views.map((v) => (
                    <li key={v.id}>
                      👁 {v.username} —{" "}
                      {v.camera_id != null ? `câmera #${v.camera_id}` : "painel"}{" "}
                      <span className="muted">{new Date(v.created_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
