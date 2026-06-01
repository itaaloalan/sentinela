import { useEffect, useRef, useState } from "react";
import { snapshotUrl, streamWsUrl } from "../lib/api";

// Vídeo ao vivo via WebRTC (web component <video-stream> do go2rtc) com barra
// de controles própria: áudio (mudo/som), foto (snapshot) e tela cheia.
// src/mode/background são propriedades do componente, setadas via ref.
export function CameraVideo({ id, name }: { id: number; name: string }) {
  const ref = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);

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

  return (
    <div className="cam-video-wrap" ref={wrapRef}>
      <video-stream ref={ref} className="cam-video" />
      <div className="cam-controls">
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Ativar som" : "Mutar"}
        >
          {muted ? "🔇" : "🔊"}
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
