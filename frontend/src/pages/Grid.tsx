import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, listCameras, snapshotUrl, type Camera } from "../lib/api";

export default function Grid() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    listCameras()
      .then(setCameras)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"));
  }, []);

  function logout() {
    auth.logout();
    nav("/login");
  }

  return (
    <>
      <header className="app-header">
        <h1>🛡️ Sentinela</h1>
        <span className="spacer" />
        <button className="ghost" onClick={logout}>Sair</button>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        {cameras.length === 0 && !error && (
          <div className="empty">
            Nenhuma câmera cadastrada ainda.<br />
            Cadastre as câmeras (Fase 2) — ver <code>docs/ROADMAP.md</code>.
          </div>
        )}
        <div className="cam-grid">
          {cameras.map((cam) => (
            <div className="cam-card" key={cam.id}>
              <div className="video">
                {/*
                  Skeleton: mostra o snapshot proxied. Na Fase 1, trocar por live de
                  baixa latência com o web component do go2rtc:

                  1) carregar o script do go2rtc: <script src="http://<go2rtc>/api/webrtc.js"> (video-rtc.js)
                  2) <video-stream src="ws://<go2rtc>/api/ws?src=<cam.name>" mode="webrtc,mse" />

                  Ver docs/ARCHITECTURE.md.
                */}
                <img src={snapshotUrl(cam.id)} alt={cam.name} onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }} />
              </div>
              <div className="label">{cam.name}</div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
