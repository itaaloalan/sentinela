import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Overview from "./Overview";

const api = {
  getOverview: vi.fn(),
  getDaySummary: vi.fn(),
  listEvents: vi.fn(),
  listCameras: vi.fn(),
  logout: vi.fn(),
};
const nav = vi.fn();
vi.mock("../lib/api", () => ({
  auth: { logout: (...a: unknown[]) => api.logout(...a) },
  getOverview: (...a: unknown[]) => api.getOverview(...a),
  getDaySummary: (...a: unknown[]) => api.getDaySummary(...a),
  listEvents: (...a: unknown[]) => api.listEvents(...a),
  listCameras: (...a: unknown[]) => api.listCameras(...a),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => nav };
});

beforeEach(() => {
  api.getOverview.mockReset().mockResolvedValue({
    cameras: [{ name: "frente", online: true }, { name: "quintal", online: false }],
    events_today: 4,
    disk_percent: 50,
  });
  api.getDaySummary.mockReset().mockResolvedValue({
    date: "2026-06-01", total: 4, by_camera: [], by_label: [],
    first_at: null, last_at: null, busiest_hour: null,
    text: "Entre 08:00 e 21:55 houve 4 evento(s).",
  });
  api.listEvents.mockReset().mockResolvedValue([
    { id: 1, model_id: 1, camera_id: 1, label: "aberto", snapshot: "s", created_at: "2026-06-01T21:55:00" },
  ]);
  api.listCameras.mockReset().mockResolvedValue([{ id: 1, name: "frente", source: "x", kind: "rtsp", ptz_enabled: false }]);
  nav.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Overview />
    </MemoryRouter>,
  );
}

describe("Overview", () => {
  it("shows house status, last movement and the AI summary", async () => {
    renderPage();
    expect(await screen.findByText("1/2")).toBeInTheDocument(); // câmeras online
    expect(screen.getByText("4")).toBeInTheDocument(); // alertas hoje
    expect(screen.getByText(/Último movimento:/)).toBeInTheDocument();
    expect(screen.getByText("frente")).toBeInTheDocument();
    expect(screen.getByText(/houve 4 evento/)).toBeInTheDocument();
  });

  it("navigates to cameras via the main button", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Ver câmeras →" }));
    expect(nav).toHaveBeenCalledWith("/cameras");
  });

  it("navigates to cameras via the menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Menu de ações" }));
    await user.click(screen.getByRole("button", { name: "📹 Câmeras" }));
    expect(nav).toHaveBeenCalledWith("/cameras");
  });

  it("navigates to every section from the menu", async () => {
    const user = userEvent.setup();
    renderPage();
    const targets: [string, string][] = [
      ["🧠 Treinos", "/treinos"],
      ["🔔 Eventos", "/eventos"],
      ["📋 Resumo", "/resumo"],
      ["👁 Vigilante", "/vigilante"],
      ["👨‍👩‍👧 Família", "/familia"],
      ["📲 Notificações", "/notificacoes"],
      ["❤️ Saúde", "/saude"],
    ];
    for (const [label, path] of targets) {
      await user.click(screen.getByRole("button", { name: "Menu de ações" }));
      await user.click(screen.getByRole("button", { name: label }));
      expect(nav).toHaveBeenCalledWith(path);
    }
  });

  it("logs out from the menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Menu de ações" }));
    await user.click(screen.getByRole("button", { name: "🚪 Sair" }));
    expect(api.logout).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith("/login");
  });

  it("falls back to câmera #id when the camera name is unknown", async () => {
    api.listEvents.mockResolvedValue([
      { id: 9, model_id: 1, camera_id: 7, label: "x", snapshot: "s", created_at: "2026-06-01T10:00:00" },
    ]);
    renderPage();
    expect(await screen.findByText("câmera #7")).toBeInTheDocument();
  });

  it("shows the empty state when there is no movement", async () => {
    api.listEvents.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Nenhum movimento registrado hoje/)).toBeInTheDocument();
  });

  it("shows placeholders while loading", async () => {
    api.getOverview.mockReturnValue(new Promise(() => {}));
    api.getDaySummary.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText("Carregando resumo…")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
