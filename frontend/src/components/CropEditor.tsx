import { useRef, useState } from "react";
import type { Crop } from "../lib/api";
import { AsyncButton } from "./AsyncButton";

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Seletor visual de recorte: arraste um retângulo sobre o quadro da câmera
 * (ex.: câmera com duas lentes lado a lado → recortar só o lado do portão).
 * Converte a seleção exibida em pixels do frame de origem (naturalWidth/Height)
 * e entrega via onSave. Sem recorte = IA usa o quadro inteiro.
 */
export function CropEditor({
  src,
  crop,
  onSave,
}: {
  src: string;
  crop: Crop | null;
  onSave: (crop: Crop) => Promise<void> | void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [sel, setSel] = useState<Rect | null>(null);
  const [saved, setSaved] = useState("");

  function at(e: React.PointerEvent) {
    const r = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - r.left, 0), r.width),
      y: Math.min(Math.max(e.clientY - r.top, 0), r.height),
    };
  }

  function down(e: React.PointerEvent) {
    setSaved("");
    const p = at(e);
    start.current = p;
    setSel({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function move(e: React.PointerEvent) {
    if (!start.current) return;
    const p = at(e);
    const s = start.current;
    setSel({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  }

  function up() {
    start.current = null;
  }

  async function save() {
    const img = imgRef.current!;
    const r = stageRef.current!.getBoundingClientRect();
    const sx = img.naturalWidth / r.width;
    const sy = img.naturalHeight / r.height;
    const s = sel!; // botão fica desabilitado enquanto não há seleção
    const c = {
      x1: Math.round(s.x * sx),
      y1: Math.round(s.y * sy),
      x2: Math.round((s.x + s.w) * sx),
      y2: Math.round((s.y + s.h) * sy),
    };
    await onSave(c);
    setSel(null); // some com o retângulo de edição
    setSaved(`✓ recorte salvo: (${c.x1},${c.y1}) → (${c.x2},${c.y2})`);
  }

  return (
    <div className="crop-editor">
      <div
        className="crop-stage"
        ref={stageRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        <img ref={imgRef} src={src} alt="quadro da câmera" draggable={false} />
        {sel && (
          <div
            className="crop-rect"
            style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}
          />
        )}
      </div>
      <div className="crop-actions">
        <span className={saved ? "hint crop-saved" : "hint"}>
          {saved
            ? saved
            : sel
              ? "arraste de novo para ajustar, depois salve"
              : crop
                ? `recorte salvo: (${crop.x1},${crop.y1}) → (${crop.x2},${crop.y2})`
                : "sem recorte — a IA usa o quadro inteiro. Arraste sobre o portão."}
        </span>
        <AsyncButton className="primary" disabled={!sel} onClick={save}>
          Salvar recorte
        </AsyncButton>
      </div>
    </div>
  );
}
