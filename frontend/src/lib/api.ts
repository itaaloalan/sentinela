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

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    // FastAPI manda {"detail": "..."} — mostra só a mensagem, não o JSON cru
    return JSON.parse(text).detail ?? text;
  } catch {
    return text || res.statusText;
  }
}

async function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (auth.token) headers.set("Authorization", `Bearer ${auth.token}`);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new Error(await errorMessage(res));
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
  alert_label: string;
  debounce_seconds: number;
  crop: Crop | null;
  version: number;
  accuracy: number | null;
  active: boolean;
  status: string;
  frames: Record<string, number>;
}

export interface ModelPatch {
  name?: string;
  classes?: string[];
  alert_label?: string;
  debounce_seconds?: number;
}

export async function listModels(): Promise<AIModel[]> {
  return (await req("/api/models")).json();
}

export async function createModel(
  cameraId: number,
  name: string,
  classes?: string[],
  alertLabel?: string,
): Promise<AIModel> {
  const body: Record<string, unknown> = { camera_id: cameraId, name };
  if (classes) body.classes = classes;
  if (alertLabel) body.alert_label = alertLabel;
  const res = await req("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function updateModel(id: number, patch: ModelPatch): Promise<AIModel> {
  return (
    await req(`/api/models/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  ).json();
}

export async function deleteModel(id: number): Promise<void> {
  await req(`/api/models/${id}`, { method: "DELETE" });
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

export interface TestResult {
  label: string | null;
  confidence: number | null;
}

export async function testModel(id: number): Promise<TestResult> {
  return (await req(`/api/models/${id}/test`, { method: "POST" })).json();
}

// ---- Eventos (alertas do monitor) ----

export interface AlertEvent {
  id: number;
  model_id: number;
  camera_id: number;
  label: string;
  snapshot: string;
  created_at: string;
}

export async function listEvents(): Promise<AlertEvent[]> {
  return (await req("/api/events")).json();
}

export function eventSnapshotUrl(id: number) {
  return `/api/events/${id}/snapshot?token=${encodeURIComponent(auth.token ?? "")}`;
}

// ---- Notificações (ntfy) ----

export interface NotifyConfig {
  server: string;
  topic: string;
  app_public_url: string;
  configured: boolean;
  discord_enabled: boolean;
}

// ---- Status dos serviços ----

export interface SystemStatusInfo {
  backend: boolean;
  go2rtc: boolean;
  ai: boolean;
}

export async function getSystemStatus(): Promise<SystemStatusInfo> {
  return (await req("/api/status")).json();
}

// ---- Saúde do sistema / dashboard ----

export interface HealthInfo {
  events_today: number;
  disk: { total: number; used: number; free: number; percent: number } | null;
  temperature_c: number | null;
  cameras: { name: string; online: boolean }[];
  go2rtc: { reachable: boolean; log: string[] };
  ai: { online: boolean; last_seen_seconds: number | null };
  backend: { log: string[] };
}

export async function getHealth(): Promise<HealthInfo> {
  return (await req("/api/status/health")).json();
}

// ---- Acesso remoto (compartilhar) ----

export interface AccessInfo {
  username: string;
  password: string;
  local_url: string;
  tailscale_url: string | null;
  public_url: string | null;
}

export async function getAccessInfo(): Promise<AccessInfo> {
  return (await req("/api/access")).json();
}

export async function getNotifyConfig(): Promise<NotifyConfig> {
  return (await req("/api/notify/config")).json();
}

export async function setNotifyTopic(topic: string): Promise<NotifyConfig> {
  return (
    await req("/api/notify/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    })
  ).json();
}

export async function setDiscordWebhook(webhook: string): Promise<NotifyConfig> {
  return (
    await req("/api/notify/discord", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhook }),
    })
  ).json();
}

export async function sendTestNotification(): Promise<{ sent: boolean; topic: string }> {
  return (await req("/api/notify/test", { method: "POST" })).json();
}
