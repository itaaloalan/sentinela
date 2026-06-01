import { useEffect, useRef, useState } from "react";
import { ptzMove, snapshotUrl, streamWsUrl } from "../lib/api";

// Vídeo ao vivo via WebRTC (web component <video-stream> do go2rtc) com barra
// de controles própria: áudio, zoom/pan digital, foto, tela cheia e — quando
// `ptz` — um D-pad de PTZ mecânico (ONVIF) com pressionar-e-segurar.
export function CameraVideo({
  id,
  name,
  ptz = false,
}: {
  id: number;
  name: string;
  ptz?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [muted, setMuted] = useState(true);
  const [talking, setTalking] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current as unknown as {
      mode: string;
      media: string;
      background: boolean;
      src: string;
    };
    // falar exige WebRTC (MSE não envia áudio de volta) + microfone no media.
    el.mode = talking ? "webrtc" : "webrtc,mse";
    el.media = talking ? "video,audio,microphone" : "video,audio";
    el.background = false;
    el.src = streamWsUrl(name);
  }, [name, talking]);

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

  // PTZ mecânico: pressiona pra mover, solta pra parar.
  function ptzHold(pan: number, tilt: number, zoom: number) {
    return {
      onPointerDown: () => ptzMove(id, pan, tilt, zoom),
      onPointerUp: () => ptzMove(id, 0, 0, 0),
    };
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
        <button
          type="button"
          onClick={() => setTalking((t) => !t)}
          aria-label={talking ? "Parar de falar" : "Falar"}
        >
          {talking ? "🛑🎤" : "🎤"}
        </button>
        <button type="button" onClick={snapshot} aria-label="Tirar foto">
          📷
        </button>
        <button type="button" onClick={toggleFullscreen} aria-label="Tela cheia">
          ⛶
        </button>
      </div>
      {ptz && (
        <div className="ptz-pad">
          <button type="button" aria-label="Cima" {...ptzHold(0, 0.5, 0)}>↑</button>
          <div className="ptz-mid">
            <button type="button" aria-label="Esquerda" {...ptzHold(-0.5, 0, 0)}>←</button>
            <button type="button" aria-label="Aproximar lente" {...ptzHold(0, 0, 0.5)}>🔍+</button>
            <button type="button" aria-label="Afastar lente" {...ptzHold(0, 0, -0.5)}>🔍−</button>
            <button type="button" aria-label="Direita" {...ptzHold(0.5, 0, 0)}>→</button>
          </div>
          <button type="button" aria-label="Baixo" {...ptzHold(0, -0.5, 0)}>↓</button>
        </div>
      )}
    </div>
  );
}
