import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getNotifyConfig,
  sendTestNotification,
  setDiscordWebhook,
  setNotifyTopic,
  type NotifyConfig,
} from "../lib/api";
import { AsyncButton } from "../components/AsyncButton";

function randomTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `sentinela-${hex}`;
}

export default function Notifications() {
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [topic, setTopic] = useState("");
  const [discord, setDiscord] = useState("");
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    getNotifyConfig()
      .then((c) => {
        setCfg(c);
        setTopic(c.topic);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, []);

  async function run(fn: () => Promise<void>) {
    setError("");
    setTestMsg("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    }
  }

  function save() {
    return run(async () => {
      const c = await setNotifyTopic(topic.trim());
      setCfg(c);
      setTopic(c.topic);
    });
  }

  function saveDiscord(webhook: string) {
    return run(async () => {
      const c = await setDiscordWebhook(webhook);
      setCfg(c);
      setDiscord("");
    });
  }

  function sendTest() {
    return run(async () => {
      const r = await sendTestNotification();
      setTestMsg(`Enviado para "${r.topic}" — veja a notificação (e o Discord, se ligado).`);
    });
  }

  function copy(text: string) {
    return navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const dirty = cfg !== null && topic.trim() !== cfg.topic;

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
            </p>

            {!cfg.configured && (
              <div className="error">
                ⚠️ O tópico atual parece ser o placeholder ou é curto demais. Gere um
                novo abaixo e salve.
              </div>
            )}

            <div className="notify-field">
              <label htmlFor="topic">Tópico (sua "chave" secreta)</label>
              <div className="notify-topic">
                <input
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  spellCheck={false}
                />
                <button type="button" className="ghost" onClick={() => setTopic(randomTopic())}>
                  Gerar aleatório
                </button>
                <button type="button" className="ghost" onClick={() => copy(cfg.topic)}>
                  {copied ? "copiado ✓" : "copiar atual"}
                </button>
              </div>
              <div className="notify-actions">
                <AsyncButton className="primary" disabled={!dirty} onClick={save}>
                  Salvar tópico
                </AsyncButton>
                {dirty && <span className="hint">alteração não salva</span>}
                <AsyncButton className="ghost" onClick={sendTest}>
                  Enviar teste
                </AsyncButton>
              </div>
              {testMsg && <div className="notify-sent">{testMsg}</div>}
            </div>

            <div className="notify-field">
              <label htmlFor="discord">
                Discord (opcional) —{" "}
                {cfg.discord_enabled ? "✅ ligado" : "desligado"}
              </label>
              <div className="notify-topic">
                <input
                  id="discord"
                  placeholder="cole a URL do webhook do Discord"
                  value={discord}
                  onChange={(e) => setDiscord(e.target.value)}
                  spellCheck={false}
                />
                <AsyncButton
                  className="ghost"
                  disabled={!discord.trim()}
                  onClick={() => saveDiscord(discord.trim())}
                >
                  Salvar Discord
                </AsyncButton>
                {cfg.discord_enabled && (
                  <AsyncButton className="ghost" onClick={() => saveDiscord("")}>
                    Desligar
                  </AsyncButton>
                )}
              </div>
              <span className="hint">
                No Discord: Editar canal → Integrações → Webhooks → Novo webhook → Copiar
                URL. O alerta vai com a foto pro canal.
              </span>
            </div>

            <ol className="notify-steps">
              <li>Instale o app <strong>ntfy</strong> na App Store (iOS) ou Play Store.</li>
              <li>
                No app, toque em <strong>+ → Subscribe to topic</strong>, deixe o servidor
                como <code>{cfg.server}</code> e assine exatamente o tópico salvo acima.
              </li>
              <li>Permita notificações quando o iOS pedir, e toque em "Enviar teste".</li>
            </ol>

            <p className="hint">
              ⚠️ No <code>{cfg.server}</code> público, quem souber o tópico vê suas
              notificações e fotos — mantenha-o secreto. O link da foto usa{" "}
              <code>{cfg.app_public_url}</code>; pra abrir fora de casa, use uma URL
              acessível (ex.: seu IP do Tailscale).
            </p>
          </div>
        )}
      </main>
    </>
  );
}
