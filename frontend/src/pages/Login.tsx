import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/api";

export default function Login() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(user, pass);
      nav("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h2>🛡️ Sentinela</h2>
        <input
          placeholder="usuário"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoCapitalize="none"
        />
        <input
          type="password"
          placeholder="senha"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
