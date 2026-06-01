import { useEffect, useState } from "react";
import { getSystemStatus, type SystemStatusInfo } from "../lib/api";

// Barra sempre visível com a saúde dos serviços (backend, go2rtc, IA).
// Faz polling leve; 🔴 quando offline ou sem resposta.
export function SystemStatus() {
  const [s, setS] = useState<SystemStatusInfo | null>(null);

  useEffect(() => {
    const tick = () => getSystemStatus().then(setS).catch(() => setS(null));
    tick();
    const timer = setInterval(tick, 10000);
    return () => clearInterval(timer);
  }, []);

  const dot = (ok: boolean | undefined) => (ok ? "🟢" : "🔴");
  return (
    <div className="sys-status" title="Status dos serviços">
      <span>{dot(s?.backend)} backend</span>
      <span>{dot(s?.go2rtc)} go2rtc</span>
      <span>{dot(s?.ai)} IA</span>
    </div>
  );
}
