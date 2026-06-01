import { useEffect, useRef, useState } from "react";
import { snapshotUrl, streamWsUrl } from "../lib/api";

// Vídeo ao vivo via WebRTC (web component <video-stream> do go2rtc) com barra
// de controles própria: áudio (mudo/som), foto (snapshot) e tela cheia.
// src/mode/background são propriedades do componente, setadas via ref.
export function CameraVideo({ id, name }: { id: number; name: string }) {
  const ref = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [muted, setMuted] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current as unknown as {
      mode: string;
      background: boolean;
      src: string;
    };
    el.mode = "webrtc,mse";
    el.background = false;
    el.src = streamWsUrl(name);
  }, [name]);

  useEffect(() => {
    const video = (ref.current as HTMLElement).querySelector("video");
    if (video) (video as HTMLVideoElement).muted = muted;
  }, [muted]);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      (wrapRef.current as HTMLDivElement).requestFullscreen();
    }
  }

  function snapshot() {
    const a = document.createElement("a");
    a.href = snapshotUrl(id);
    a.download = `${name}.jpg`;
    a.click();
  }

  function zoomBy(delta: number) {
    setZoom((z) => {
      const next = Math.min(4, Math.max(1, z + delta));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (zoom > 1) drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (drag.current)
      setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  }
  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div className="cam-video-wrap" ref={wrapRef}>
      <video-stream
        ref={ref}
        className="cam-video"
        style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="cam-controls">
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Ativar som" : "Mutar"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button type="button" onClick={() => zoomBy(0.5)} aria-label="Aproximar">
          ➕
        </button>
        <button type="button" onClick={() => zoomBy(-0.5)} aria-label="Afastar">
          ➖
        </button>
        <button type="button" onClick={snapshot} aria-label="Tirar foto">
          📷
        </button>
        <button type="button" onClick={toggleFullscreen} aria-label="Tela cheia">
          ⛶
        </button>
      </div>
    </div>
  );
}
