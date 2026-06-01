import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Health from "./Health";

const api = { getHealth: vi.fn() };
const nav = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...a: unknown[]) => api.getHealth(...a),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => nav };
});

const FULL = {
  events_today: 5,
  disk: { total: 100, used: 40, free: 64424509440, percent: 40 },
  temperature_c: 51.2,
  cameras: [
    { name: "portao", online: true },
    { name: "quintal", online: false },
  ],
  go2rtc: { reachable: true, log: ["linha1", "linha2"] },
  ai: { online: true, last_seen_seconds: 4 },
  backend: { log: ["boot ok"] },
};

beforeEach(() => {
  api.getHealth.mockReset().mockResolvedValue(FULL);
  nav.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Health />
    </MemoryRouter>,
  );
}

describe("Health", () => {
  it("shows a loading state then the summary cards", async () => {
    renderPage();
    expect(screen.getByText(/Carregando saúde/)).toBeInTheDocument();
    expect(await screen.findByText("5")).toBeInTheDocument(); // eventos hoje
    expect(screen.getByText("1/2 online")).toBeInTheDocument();
    expect(screen.getByText(/40% · 60.0 GB livre/)).toBeInTheDocument();
    expect(screen.getByText("51.2 °C")).toBeInTheDocument();
    expect(screen.getByText(/🟢 portao/)).toBeInTheDocument();
    expect(screen.getByText(/🔴 quintal/)).toBeInTheDocument();
  });

  it("expands and collapses a service log on click", async () => {
    const user = userEvent.setup();
    renderPage();
    const btn = await screen.findByRole("button", { name: /go2rtc/ });
    await user.click(btn);
    expect(screen.getByText(/linha1/)).toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByText(/linha1/)).not.toBeInTheDocument();
  });

  it("shows 'sem linhas' for a service without log lines (IA)", async () => {
    const user = userEvent.setup();
    renderPage();
    const btn = await screen.findByRole("button", { name: /IA online/ });
    await user.click(btn);
    expect(screen.getByText("Sem linhas de log.")).toBeInTheDocument();
  });

  it("navigates back home", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "← Voltar" }));
    expect(nav).toHaveBeenCalledWith("/");
  });

  it("renders dashes when disk/temp/heartbeat are absent", async () => {
    api.getHealth.mockResolvedValue({
      ...FULL,
      disk: null,
      temperature_c: null,
      ai: { online: false, last_seen_seconds: null },
    });
    renderPage();
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /IA offline/ })).toBeInTheDocument();
  });

  it("shows an error message when the fetch fails", async () => {
    api.getHealth.mockRejectedValue(new Error("backend fora"));
    renderPage();
    expect(await screen.findByText("backend fora")).toBeInTheDocument();
  });

  it("shows a generic error when the rejection is not an Error", async () => {
    api.getHealth.mockRejectedValue("x");
    renderPage();
    expect(await screen.findByText("Erro ao carregar")).toBeInTheDocument();
  });
});
