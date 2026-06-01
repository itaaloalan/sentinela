import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev: proxy /api -> backend FastAPI (evita CORS e expõe uma origem só).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // escuta em 0.0.0.0 — sem isso o Vite só atende em localhost e a porta
    // 5173 não é alcançável pela Tailscale/LAN (acesso remoto não funciona).
    host: true,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      // go2rtc (vídeo ao vivo WebRTC): proxia API + WebSocket de sinalização,
      // mantendo tudo numa origem só (a 1984 não fica exposta ao browser direto).
      "/go2rtc": {
        target: "http://localhost:1984",
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/go2rtc/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    // origem real: sem isso o jsdom usa "about:blank" (origem opaca) e o
    // localStorage fica indisponível.
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/test/**",
        "**/*.test.{ts,tsx}",
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
