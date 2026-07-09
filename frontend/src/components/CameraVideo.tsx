import { useEffect, useRef } from "react";
import { streamWsUrl } from "../lib/api";

// Vídeo ao vivo via WebRTC (web component <video-stream> do go2rtc), sem
// controles próprios: some, mudo, e reconecta sozinho (video-rtc.js). Tela
// cheia é o único gesto — duplo clique/toque no vídeo.
export function CameraVideo({
  name,
  onPlaying,
  onFrame,
}: {
  name: string;
  /** chamado quando o vídeo realmente começa a tocar (1º frame). */
  onPlaying?: () => void;
  /** chamado a cada frame renderizado (usado para "último frame há Xs"). */
  onFrame?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current as unknown as {
      mode: string;
      media: string;
      background: boolean;
      visibilityThreshold: number;
      src: string;
    };
    el.mode = "webrtc,mse";
    // sem áudio: menos banda/CPU por stream — não há controle de som na UI.
    el.media = "video";
    el.background = false;
    // desconecta sozinho quando o card sai da viewport (IntersectionObserver
    // nativo do componente) e quando a aba fica oculta (visibilityCheck).
    el.visibilityThreshold = 0.05;
    el.src = streamWsUrl(name);
  }, [name]);

  useEffect(() => {
    // 'playing' não borbulha, mas a fase de captura passa pelo wrapper —
    // assim sabemos quando o <video> interno (criado pelo componente) tocou.
    // Aproveitamos o mesmo evento pra configurar o <video>: só existe a
    // partir daqui (é criado pelo web component), então é aqui — não num
    // efeito à parte — que dá pra travar mudo/playsInline/sem controles
    // nativos (o botão de play nativo aparecia no mobile).
    const wrap = wrapRef.current as HTMLDivElement;
    const handler = (e: Event) => {
      const video = e.target as HTMLVideoElement;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.controls = false;
      onPlaying?.();
    };
    wrap.addEventListener("playing", handler, true);
    return () => wrap.removeEventListener("playing", handler, true);
  }, [onPlaying]);

  useEffect(() => {
    // 'timeupdate' dispara a cada frame renderizado — usado para o "último
    // frame há Xs" do card, sem precisar reimplementar o player.
    if (!onFrame) return;
    const wrap = wrapRef.current as HTMLDivElement;
    const handler = () => onFrame();
    wrap.addEventListener("timeupdate", handler, true);
    return () => wrap.removeEventListener("timeupdate", handler, true);
  }, [onFrame]);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      (wrapRef.current as HTMLDivElement).requestFullscreen();
    }
  }

  return (
    <div className="cam-video-wrap" ref={wrapRef} onDoubleClick={toggleFullscreen}>
      <div className="cam-loading" aria-hidden="true">🔄 conectando…</div>
      <video-stream ref={ref} className="cam-video" />
    </div>
  );
}
