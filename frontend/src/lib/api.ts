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

export interface Camera {
  id: number;
  name: string;
  source: string;
  kind: string;
  ptz_enabled: boolean;
}

export async function listCameras(): Promise<Camera[]> {
  return (await req("/api/cameras")).json();
}

export function snapshotUrl(id: number) {
  return `/api/cameras/${id}/snapshot`;
}
