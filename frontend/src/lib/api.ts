// Cliente de API mínimo. Token JWT no localStorage (MVP).
const TOKEN_KEY = "sentinela_token";

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  set token(v: string | null) {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  },
  get isLoggedIn() {
    return !!localStorage.getItem(TOKEN_KEY);
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

async function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (auth.token) headers.set("Authorization", `Bearer ${auth.token}`);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res;
}

export async function login(username: string, password: string) {
  const body = new URLSearchParams({ username, password });
  const res = await fetch("/api/auth/login", { method: "POST", body });
  if (!res.ok) throw new Error("Credenciais inválidas");
  const data = await res.json();
  auth.token = data.access_token;
}

export interface CameraIn {
  name: string;
  source: string;
  kind: string;
  ptz_enabled: boolean;
}

export interface Camera extends CameraIn {
  id: number;
}

export async function listCameras(): Promise<Camera[]> {
  return (await req("/api/cameras")).json();
}

export async function createCamera(cam: CameraIn): Promise<Camera> {
  const res = await req("/api/cameras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cam),
  });
  return res.json();
}

export async function updateCamera(id: number, cam: CameraIn): Promise<Camera> {
  const res = await req(`/api/cameras/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cam),
  });
  return res.json();
}

export async function deleteCamera(id: number): Promise<void> {
  await req(`/api/cameras/${id}`, { method: "DELETE" });
}

// PTZ mecânico (ONVIF) — velocidades em [-1,1]; tudo 0 = parar.
export async function ptzMove(
  id: number,
  pan: number,
  tilt: number,
  zoom: number,
): Promise<void> {
  await req(`/api/cameras/${id}/ptz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pan, tilt, zoom }),
  });
}

export interface DiscoveredCamera {
  ip: string;
  mac: string | null;
  vendor: string | null;
  ports: number[];
  kind: string;
  suggested_source: string;
  label: string;
}

export interface ReachableHost {
  ip: string;
  ports: number[];
}

export interface DiscoverResult {
  subnet: string;
  scanned: number;
  reachable: ReachableHost[];
  candidates: DiscoveredCamera[];
}

export async function discoverCameras(): Promise<DiscoverResult> {
  return (await req("/api/cameras/discover")).json();
}

// Tags <img> não enviam header Authorization → token na query.
export function snapshotUrl(id: number) {
  return `/api/cameras/${id}/snapshot?token=${encodeURIComponent(auth.token ?? "")}`;
}

// URL do WebSocket de sinalização do go2rtc (proxiado em /go2rtc), usada pelo
// web component <video-stream> para o vídeo ao vivo WebRTC/MSE.
export function streamWsUrl(name: string) {
  const proto = location.protocol.replace("http", "ws"); // http→ws, https→wss
  return `${proto}//${location.host}/go2rtc/api/ws?src=${encodeURIComponent(name)}`;
}

// ---- Modelos de IA (treino do portão) ----

export interface Crop {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AIModel {
  id: number;
  camera_id: number;
  name: string;
  classes: string[];
  crop: Crop | null;
  version: number;
  accuracy: number | null;
  active: boolean;
  status: string;
  frames: Record<string, number>;
}

export async function listModels(): Promise<AIModel[]> {
  return (await req("/api/models")).json();
}

export async function createModel(cameraId: number, name: string): Promise<AIModel> {
  const res = await req("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camera_id: cameraId, name }),
  });
  return res.json();
}

export async function captureFrame(id: number, label: string): Promise<{ frames: number }> {
  return (
    await req(`/api/models/${id}/capture?label=${encodeURIComponent(label)}`, {
      method: "POST",
    })
  ).json();
}

export async function listModelFrames(id: number): Promise<Record<string, string[]>> {
  return (await req(`/api/models/${id}/frames`)).json();
}

export function modelFrameUrl(id: number, label: string, filename: string) {
  return (
    `/api/models/${id}/frames/${encodeURIComponent(label)}/${encodeURIComponent(filename)}` +
    `?token=${encodeURIComponent(auth.token ?? "")}`
  );
}

export async function deleteModelFrame(
  id: number,
  label: string,
  filename: string,
): Promise<void> {
  await req(
    `/api/models/${id}/frames/${encodeURIComponent(label)}/${encodeURIComponent(filename)}`,
    { method: "DELETE" },
  );
}

export async function setModelCrop(id: number, crop: Crop): Promise<AIModel> {
  const res = await req(`/api/models/${id}/crop`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(crop),
  });
  return res.json();
}

export async function trainModel(id: number): Promise<{ status: string }> {
  return (await req(`/api/models/${id}/train`, { method: "POST" })).json();
}

export async function activateModel(id: number, active: boolean): Promise<{ active: boolean }> {
  return (
    await req(`/api/models/${id}/activate?active=${active}`, { method: "POST" })
  ).json();
}
