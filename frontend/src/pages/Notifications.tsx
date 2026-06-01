import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getNotifyConfig, type NotifyConfig } from "../lib/api";

export default function Notifications() {
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    getNotifyConfig()
      .then(setCfg)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, []);

  function copy(text: string) {
    return navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <header className="app-header">
        <button className="ghost" onClick={() => nav("/")}>← Câmeras</button>
        <h1>📲 Notificações</h1>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {cfg && (
          <div className="notify-guide">
            <p>
              O alerta de portão aberto chega no seu iPhone pelo app <strong>ntfy</strong>{" "}
              (gratuito). Não há servidor pra configurar — o {cfg.server} entrega o push.
              Faça uma vez:
            </p>

            {!cfg.configured && (
              <div className="error">
                ⚠️ O tópico atual parece ser o placeholder ou é curto demais. Troque{" "}
                <code>NTFY_TOPIC</code> no <code>.env</code> por algo secreto e
                aleatório, reinicie o backend e assine o novo tópico no app.
              </div>
            )}

            <ol className="notify-steps">
              <li>
                Instale o app <strong>ntfy</strong> na App Store (iOS) ou Play Store.
              </li>
              <li>
                No app, toque em <strong>+ → Subscribe to topic</strong>, deixe o
                servidor como <code>{cfg.server}</code> e assine exatamente este tópico:
                <div className="notify-topic">
                  <code>{cfg.topic}</code>
                  <button className="ghost" onClick={() => copy(cfg.topic)}>
                    {copied ? "copiado ✓" : "copiar"}
                  </button>
                </div>
              </li>
              <li>Permita notificações quando o iOS pedir.</li>
            </ol>

            <p className="hint">
              Teste rápido (depois de assinar): rode no terminal e veja chegar no
              celular —
            </p>
            <pre className="notify-cmd">
              curl -d "teste do sentinela" {cfg.server}/{cfg.topic}
            </pre>

            <p className="hint">
              ⚠️ No <code>{cfg.server}</code> público, quem souber o nome do tópico vê
              suas notificações e fotos. Mantenha o tópico secreto. O link da foto na
              notificação usa <code>{cfg.app_public_url}</code> — pra abrir fora de
              casa, use uma URL acessível (ex.: seu IP do Tailscale).
            </p>
          </div>
        )}
      </main>
    </>
  );
}
