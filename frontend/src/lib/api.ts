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

export async function deleteCamera(id: number): Promise<void> {
  await req(`/api/cameras/${id}`, { method: "DELETE" });
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
