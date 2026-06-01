/// <reference types="vite/client" />

// Web component <video-stream> do go2rtc (carregado de /video-stream.js).
// src/mode/background são propriedades, setadas via ref no React.
declare namespace JSX {
  interface IntrinsicElements {
    "video-stream": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
