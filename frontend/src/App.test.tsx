import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

const state = vi.hoisted(() => ({ loggedIn: false }));

vi.mock("./lib/api", () => ({
  auth: {
    get isLoggedIn() {
      return state.loggedIn;
    },
    logout: vi.fn(),
  },
  login: vi.fn(),
  listCameras: vi.fn().mockResolvedValue([]),
  createCamera: vi.fn(),
  updateCamera: vi.fn(),
  deleteCamera: vi.fn(),
  discoverCameras: vi.fn().mockResolvedValue({ subnet: "", scanned: 0, reachable: [], candidates: [] }),
  streamWsUrl: (name: string) => `ws://localhost/go2rtc/api/ws?src=${name}`,
  snapshotUrl: (id: number) => `/api/cameras/${id}/snapshot?token=`,
  ptzMove: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  createModel: vi.fn(),
  captureFrame: vi.fn(),
  listModelFrames: vi.fn().mockResolvedValue({}),
  deleteModelFrame: vi.fn(),
  setModelCrop: vi.fn(),
  trainModel: vi.fn(),
  testModel: vi.fn(),
  activateModel: vi.fn(),
  modelFrameUrl: () => "",
  listEvents: vi.fn().mockResolvedValue([]),
  getOverview: vi.fn().mockResolvedValue({ cameras: [], events_today: 0, disk_percent: null }),
  eventSnapshotUrl: () => "",
  getSystemStatus: vi.fn().mockResolvedValue({ backend: true, go2rtc: true, ai: true }),
  getAccessInfo: vi.fn(),
  getHealth: vi.fn(),
  getDaySummary: vi.fn(),
  askSummary: vi.fn(),
  getVigilanteConfig: vi.fn().mockResolvedValue({ enabled: false }),
  listObservations: vi.fn().mockResolvedValue([]),
  setVigilante: vi.fn(),
  testVigilante: vi.fn(),
  observationSnapshotUrl: () => "",
  recordView: vi.fn().mockResolvedValue(undefined),
  listUsers: vi.fn().mockResolvedValue([]),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  listViews: vi.fn().mockResolvedValue([]),
  sendEmergency: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.loggedIn = false;
});

describe("App routing", () => {
  it("redirects to /login when logged out", () => {
    renderAt("/");
    expect(screen.getByPlaceholderText("usuário")).toBeInTheDocument();
  });

  it("renders the grid when logged in", async () => {
    state.loggedIn = true;
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Menu de ações" })).toBeInTheDocument();
  });

  it("redirects unknown routes home", async () => {
    state.loggedIn = true;
    renderAt("/rota-inexistente");
    expect(await screen.findByRole("button", { name: "Menu de ações" })).toBeInTheDocument();
  });

  it("renders the training page on /treinos when logged in", async () => {
    state.loggedIn = true;
    renderAt("/treinos");
    expect(
      await screen.findByRole("heading", { name: /Treino da IA/ }),
    ).toBeInTheDocument();
  });

  it("renders the events page on /eventos when logged in", async () => {
    state.loggedIn = true;
    renderAt("/eventos");
    expect(
      await screen.findByRole("heading", { name: /Eventos/ }),
    ).toBeInTheDocument();
  });
});
