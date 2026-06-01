import { useState } from "react";

// Botão para ações assíncronas: ao clicar, bloqueia e mostra "…" até a Promise
// resolver, depois reabilita. Padroniza o feedback de carregamento no app.
export function AsyncButton({
  onClick,
  children,
  className,
  disabled = false,
  label,
}: {
  onClick: () => Promise<unknown> | void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-busy={busy}
      disabled={busy || disabled}
      onClick={handle}
    >
      {busy ? "…" : children}
    </button>
  );
}
