import { useState } from "react";
import { getAccessInfo, type AccessInfo } from "../lib/api";

// Botão "🔗 Acesso": abre um painel com as URLs de acesso (Tailscale / IP
// público / local) e as credenciais. Cada endereço tem um "Copiar" que leva
// junto o usuário e a senha — pra colar e mandar pra alguém de uma vez.
type Target = { key: string; label: string; url: string };

export function AccessShare() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError("");
    try {
      setInfo(await getAccessInfo());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao obter acesso");
    }
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
  }

  function targets(data: AccessInfo): Target[] {
    const all = [
      data.tailscale_url && { key: "tailscale", label: "Tailscale", url: data.tailscale_url },
      data.public_url && { key: "public", label: "IP público", url: data.public_url },
      { key: "local", label: "Local", url: data.local_url },
    ];
    return all.filter((t): t is Target => Boolean(t));
  }

  return (
    <div className="access-share">
      <button type="button" onClick={toggle} aria-expanded={open}>
        🔗 Acesso
      </button>
      {open && (
        <div className="access-panel" role="dialog" aria-label="Acesso remoto">
          {error && <p className="access-error">{error}</p>}
          {info && (
            <>
              <p className="access-creds">
                👤 <strong>{info.username}</strong> · 🔑 <code>{info.password}</code>
              </p>
              <ul className="access-list">
                {targets(info).map((t) => (
                  <li key={t.key}>
                    <span className="access-label">{t.label}</span>
                    <code className="access-url">{t.url}</code>
                    <button
                      type="button"
                      onClick={() =>
                        copy(
                          t.key,
                          `Sentinela\nEndereço: ${t.url}\nUsuário: ${info.username}\nSenha: ${info.password}`,
                        )
                      }
                    >
                      {copied === t.key ? "✓ copiado" : "Copiar"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
