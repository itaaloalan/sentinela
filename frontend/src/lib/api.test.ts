import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateModel,
  auth,
  captureFrame,
  createCamera,
  createModel,
  deleteCamera,
  deleteModel,
  deleteModelFrame,
  discoverCameras,
  askSummary,
  createUser,
  deleteUser,
  listUsers,
  listViews,
  recordView,
  sendEmergency,
  testVigilante,
  eventSnapshotUrl,
  getAccessInfo,
  getDaySummary,
  getHealth,
  getOverview,
  getVigilanteConfig,
  listObservations,
  observationSnapshotUrl,
  setVigilante,
  getNotifyConfig,
  getSystemStatus,
  sendTestNotification,
  setDiscordWebhook,
  setNotifyTopic,
  listEvents,
  listCameras,
  listModelFrames,
  listModels,
  login,
  modelFrameUrl,
  updateModel,
  setModelCrop,
  testModel,
  snapshotUrl,
  streamWsUrl,
  trainModel,
  updateCamera,
} from "./api";

function mockResponse(opts: {
  ok?: boolean;
  json?: unknown;
  text?: string;
  statusText?: string;
}) {
  return {
    ok: opts.ok ?? true,
    statusText: opts.statusText ?? "",
    json: async () => opts.json,
    text: async () => opts.text ?? "",
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth store", () => {
  it("set/get/logout/isLoggedIn", () => {
    expect(auth.token).toBeNull();
    expect(auth.isLoggedIn).toBe(false);
    auth.token = "abc";
    expect(auth.token).toBe("abc");
    expect(auth.isLoggedIn).toBe(true);
    auth.token = null;
    expect(auth.token).toBeNull();
    auth.token = "xyz";
    auth.logout();
    expect(auth.isLoggedIn).toBe(false);
  });
});

describe("login", () => {
  it("stores the token on success", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ json: { access_token: "tok123" } }),
    );
    await login("admin", "secret");
    expect(auth.token).toBe("tok123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
  });

  it("stores the role and clears it on logout", async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: { access_token: "t", role: "admin" } }));
    await login("admin", "secret");
    expect(auth.role).toBe("admin");
    expect(auth.isAdmin).toBe(true);
    auth.logout();
    expect(auth.role).toBeNull();
    expect(auth.isAdmin).toBe(false);
  });

  it("handles a missing role in the response", async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: { access_token: "t" } }));
    await login("x", "y");
    expect(auth.role).toBeNull();
  });

  it("throws on bad credentials", async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: false }));
    await expect(login("admin", "wrong")).rejects.toThrow("Credenciais inválidas");
  });
});

describe("authenticated requests", () => {
  it("adds the Authorization header when a token exists", async () => {
    auth.token = "tok";
    fetchMock.mockResolvedValue(mockResponse({ json: [{ id: 1 }] }));
    const cams = await listCameras();
    expect(cams).toEqual([{ id: 1 }]);
    const headers: Headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("omits the Authorization header when logged out", async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: [] }));
    await listCameras();
    const headers: Headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("throws the response text on error", async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: false, text: "boom" }));
    await expect(listCameras()).rejects.toThrow("boom");
  });

  it("falls back to statusText when the body is empty", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, text: "", statusText: "Bad Gateway" }),
    );
    await expect(listCameras()).rejects.toThrow("Bad Gateway");
  });

  it("extracts FastAPI's detail from a JSON error body", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, text: '{"detail":"Modelo ainda não treinado"}' }),
    );
    await expect(listCameras()).rejects.toThrow("Modelo ainda não treinado");
  });

  it("falls back to the raw JSON when there is no detail field", async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: false, text: "[1,2]" }));
    await expect(listCameras()).rejects.toThrow("[1,2]");
  });

  it("createCamera posts JSON and returns the camera", async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 7, name: "portao" } }));
    const cam = await createCamera({
      name: "portao",
      source: "rtsp://x",
      kind: "rtsp",
      ptz_enabled: false,
    });
    expect(cam).toEqual({ id: 7, name: "portao" });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ name: "portao" });
  });

  it("updateCamera issues a PUT with JSON", async () => {
    auth.token = "tok";
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 7, name: "portao" } }));
    const cam = await updateCamera(7, {
      name: "portao",
      source: "rtsp://x",
      kind: "rtsp",
      ptz_enabled: false,
    });
    expect(cam).toEqual({ id: 7, name: "portao" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cameras/7");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toMatchObject({ name: "portao" });
  });

  it("deleteCamera issues a DELETE", async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: null }));
    await deleteCamera(9);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cameras/9");
    expect(init.method).toBe("DELETE");
  });

  it("discoverCameras fetches the discover endpoint", async () => {
    auth.token = "tok";
    const payload = { subnet: "192.168.0.0/24", scanned: 254, reachable: [], candidates: [] };
    fetchMock.mockResolvedValue(mockResponse({ json: payload }));
    expect(await discoverCameras()).toEqual(payload);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cameras/discover");
  });
});

describe("snapshotUrl", () => {
  it("includes the token in the query when logged in", () => {
    auth.token = "tok";
    expect(snapshotUrl(3)).toBe("/api/cameras/3/snapshot?token=tok");
  });

  it("uses an empty token when logged out", () => {
    expect(snapshotUrl(3)).toBe("/api/cameras/3/snapshot?token=");
  });
});

describe("streamWsUrl", () => {
  it("builds the proxied go2rtc WebSocket URL", () => {
    // jsdom roda em http://localhost/ → ws
    expect(streamWsUrl("portao")).toBe(
      "ws://localhost/go2rtc/api/ws?src=portao",
    );
  });
});

describe("AI model API", () => {
  it("listModels GETs /api/models", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: [{ id: 1 }] }));
    expect(await listModels()).toEqual([{ id: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/models");
  });

  it("createModel posts camera_id + name", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 1 } }));
    await createModel(2, "portao");
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ camera_id: 2, name: "portao" });
  });

  it("createModel includes classes and alert_label when given", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 1 } }));
    await createModel(2, "pia", ["vazamento", "seco"], "vazamento");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      camera_id: 2,
      name: "pia",
      classes: ["vazamento", "seco"],
      alert_label: "vazamento",
    });
  });

  it("updateModel PUTs the patch as JSON", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 1 } }));
    await updateModel(1, { name: "novo", debounce_seconds: 60 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/models/1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ name: "novo", debounce_seconds: 60 });
  });

  it("deleteModel DELETEs the model", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ ok: true, text: "" }));
    await deleteModel(5);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/models/5");
    expect(init.method).toBe("DELETE");
  });

  it("captureFrame posts with the label query", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { frames: 1 } }));
    await captureFrame(1, "aberto");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/models/1/capture?label=aberto");
    expect(init.method).toBe("POST");
  });

  it("listModelFrames GETs the frames map", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { aberto: [] } }));
    expect(await listModelFrames(1)).toEqual({ aberto: [] });
  });

  it("modelFrameUrl includes the token", () => {
    auth.token = "t";
    expect(modelFrameUrl(1, "aberto", "f.jpg")).toBe(
      "/api/models/1/frames/aberto/f.jpg?token=t",
    );
  });

  it("modelFrameUrl uses empty token when logged out", () => {
    expect(modelFrameUrl(1, "aberto", "f.jpg")).toBe(
      "/api/models/1/frames/aberto/f.jpg?token=",
    );
  });

  it("deleteModelFrame issues a DELETE", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: null }));
    await deleteModelFrame(1, "aberto", "f.jpg");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/models/1/frames/aberto/f.jpg");
    expect(init.method).toBe("DELETE");
  });

  it("setModelCrop PUTs the crop", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 1 } }));
    await setModelCrop(1, { x1: 1, y1: 2, x2: 3, y2: 4 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/models/1/crop");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });

  it("trainModel posts to /train", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { status: "treinando" } }));
    expect(await trainModel(1)).toEqual({ status: "treinando" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/models/1/train");
  });

  it("activateModel posts with the active query", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { active: true } }));
    await activateModel(1, true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/models/1/activate?active=true");
  });

  it("testModel posts to /test", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { label: "aberto", confidence: 0.9 } }));
    expect(await testModel(1)).toEqual({ label: "aberto", confidence: 0.9 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/models/1/test");
  });

  it("listEvents GETs /api/events", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: [{ id: 1 }] }));
    expect(await listEvents()).toEqual([{ id: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/events");
  });

  it("eventSnapshotUrl includes the token", () => {
    auth.token = "t";
    expect(eventSnapshotUrl(5)).toBe("/api/events/5/snapshot?token=t");
  });

  it("eventSnapshotUrl uses empty token when logged out", () => {
    expect(eventSnapshotUrl(5)).toBe("/api/events/5/snapshot?token=");
  });

  it("getSystemStatus GETs /api/status", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { backend: true, go2rtc: false, ai: true } }));
    expect(await getSystemStatus()).toEqual({ backend: true, go2rtc: false, ai: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/status");
  });

  it("getAccessInfo GETs /api/access", async () => {
    auth.token = "t";
    const info = {
      username: "admin",
      password: "secret",
      local_url: "http://localhost:5173",
      tailscale_url: null,
      public_url: null,
    };
    fetchMock.mockResolvedValue(mockResponse({ json: info }));
    expect(await getAccessInfo()).toEqual(info);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/access");
  });

  it("getHealth GETs /api/status/health", async () => {
    auth.token = "t";
    const info = {
      events_today: 3,
      disk: null,
      temperature_c: null,
      cameras: [],
      go2rtc: { reachable: true, log: [] },
      ai: { online: false, last_seen_seconds: null },
      backend: { log: [] },
    };
    fetchMock.mockResolvedValue(mockResponse({ json: info }));
    expect(await getHealth()).toEqual(info);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/status/health");
  });

  it("getDaySummary GETs /api/summary/today", async () => {
    auth.token = "t";
    const sum = { date: "2026-06-01", total: 0, by_camera: [], by_label: [], first_at: null, last_at: null, busiest_hour: null, text: "x" };
    fetchMock.mockResolvedValue(mockResponse({ json: sum }));
    expect(await getDaySummary()).toEqual(sum);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/summary/today");
  });

  it("askSummary POSTs the question as JSON", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { question: "q", answer: "a" } }));
    expect(await askSummary("quando?")).toEqual({ question: "q", answer: "a" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/summary/ask");
    expect(JSON.parse(init.body)).toEqual({ question: "quando?" });
  });

  it("listObservations GETs /api/observations", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: [{ id: 1 }] }));
    expect(await listObservations()).toEqual([{ id: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/observations");
  });

  it("getVigilanteConfig GETs the config", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { enabled: true } }));
    expect(await getVigilanteConfig()).toEqual({ enabled: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/observations/config");
  });

  it("setVigilante PUTs the enabled flag as JSON", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { enabled: false } }));
    expect(await setVigilante(false)).toEqual({ enabled: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/observations/config");
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });

  it("observationSnapshotUrl embeds the token (and empty when logged out)", () => {
    auth.token = "tok";
    expect(observationSnapshotUrl(7)).toBe("/api/observations/7/snapshot?token=tok");
    auth.token = null;
    expect(observationSnapshotUrl(7)).toBe("/api/observations/7/snapshot?token=");
  });

  it("testVigilante POSTs /api/observations/test with camera_id", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { description: "x", objects: [], saved: false } }));
    await testVigilante(5);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/observations/test?camera_id=5");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("listUsers GETs /api/family/users", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: [{ id: 1, username: "admin", role: "admin" }] }));
    expect(await listUsers()).toEqual([{ id: 1, username: "admin", role: "admin" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/family/users");
  });

  it("createUser POSTs the new user as JSON", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 2, username: "maria", role: "familiar" } }));
    await createUser("maria", "p", "familiar");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/family/users");
    expect(JSON.parse(init.body)).toEqual({ username: "maria", password: "p", role: "familiar" });
  });

  it("deleteUser DELETEs the user", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { deleted: 2 } }));
    await deleteUser(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/family/users/2");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("listViews GETs /api/family/views", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: [] }));
    expect(await listViews()).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/family/views");
  });

  it("recordView POSTs the camera_id", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { id: 1 } }));
    await recordView(null);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/family/views");
    expect(JSON.parse(init.body)).toEqual({ camera_id: null });
  });

  it("sendEmergency POSTs /api/family/emergency", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { sent: true } }));
    expect(await sendEmergency()).toEqual({ sent: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/family/emergency");
  });

  it("getOverview GETs /api/status/overview", async () => {
    auth.token = "t";
    const ov = { cameras: [], events_today: 0, disk_percent: null };
    fetchMock.mockResolvedValue(mockResponse({ json: ov }));
    expect(await getOverview()).toEqual(ov);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/status/overview");
  });

  it("getNotifyConfig GETs /api/notify/config", async () => {
    auth.token = "t";
    const cfg = { server: "https://ntfy.sh", topic: "x", app_public_url: "u", configured: true };
    fetchMock.mockResolvedValue(mockResponse({ json: cfg }));
    expect(await getNotifyConfig()).toEqual(cfg);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notify/config");
  });

  it("setNotifyTopic PUTs the topic as JSON", async () => {
    auth.token = "t";
    const cfg = { server: "s", topic: "novo", app_public_url: "u", configured: true };
    fetchMock.mockResolvedValue(mockResponse({ json: cfg }));
    expect(await setNotifyTopic("novo")).toEqual(cfg);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/notify/config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ topic: "novo" });
  });

  it("setDiscordWebhook PUTs /api/notify/discord", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { discord_enabled: true } }));
    await setDiscordWebhook("https://discord.com/api/webhooks/1/x");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/notify/discord");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ webhook: "https://discord.com/api/webhooks/1/x" });
  });

  it("sendTestNotification POSTs /api/notify/test", async () => {
    auth.token = "t";
    fetchMock.mockResolvedValue(mockResponse({ json: { sent: true, topic: "x" } }));
    expect(await sendTestNotification()).toEqual({ sent: true, topic: "x" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/notify/test");
    expect(init.method).toBe("POST");
  });
});
