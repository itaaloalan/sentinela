import { useState, type ReactNode } from "react";

// Menu de ações (☰): drawer que abre da direita com os itens "do resto" — pra
// manter o dashboard limpo (só câmeras), principalmente no mobile. Clicar em
// qualquer item (ou no fundo) fecha o menu.
export function ActionsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="ghost menu-btn"
        aria-label="Menu de ações"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ☰
      </button>
      {open && (
        <>
          <div className="menu-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <nav className="actions-menu" onClick={() => setOpen(false)}>
            {children}
          </nav>
        </>
      )}
    </>
  );
}
