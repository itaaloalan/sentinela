import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auth,
  createCamera,
  deleteCamera,
  discoverCameras,
  listCameras,
  login,
  snapshotUrl,
  streamWsUrl,
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
