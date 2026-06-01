import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Summary from "./Summary";

const api = { getDaySummary: vi.fn(), askSummary: vi.fn() };
const nav = vi.fn();
vi.mock("../lib/api", () => ({
  getDaySummary: (...a: unknown[]) => api.getDaySummary(...a),
  askSummary: (...a: unknown[]) => api.askSummary(...a),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => nav };
});

const FULL = {
  date: "2026-06-01",
  total: 3,
  by_camera: [{ camera: "portao", count: 3 }],
  by_label: [{ label: "aberto", count: 2 }, { label: "fechado", count: 1 }],
  first_at: "2026-06-01T08:00:00+00:00",
  last_at: "2026-06-01T17:05:00+00:00",
  busiest_hour: 8,
  text: "Entre 08:00 e 17:05 houve 3 evento(s).",
};

beforeEach(() => {
  api.getDaySummary.mockReset().mockResolvedValue(FULL);
  api.askSummary.mockReset().mockResolvedValue({ question: "q", answer: "Hoje houve 3 evento(s)." });
  nav.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Summary />
    </MemoryRouter>,
  );
}

describe("Summary", () => {
  it("shows loading then the day summary and breakdown", async () => {
    renderPage();
    expect(screen.getByText(/Carregando resumo/)).toBeInTheDocument();
    expect(await screen.findByText(/Entre 08:00 e 17:05/)).toBeInTheDocument();
    expect(screen.getByText("2× aberto")).toBeInTheDocument();
    expect(screen.getByText("📷 portao: 3")).toBeInTheDocument();
  });

  it("answers a natural-language question", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Entre 08:00/);
    await user.type(screen.getByLabelText("pergunta"), "quantos eventos?");
    await user.click(screen.getByRole("button", { name: "Perguntar" }));
    expect(await screen.findByText(/💬 Hoje houve 3 evento/)).toBeInTheDocument();
    expect(api.askSummary).toHaveBeenCalledWith("quantos eventos?");
  });

  it("shows an error answer when asking fails (Error)", async () => {
    api.askSummary.mockRejectedValue(new Error("falhou"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Entre 08:00/);
    await user.type(screen.getByLabelText("pergunta"), "x");
    await user.click(screen.getByRole("button", { name: "Perguntar" }));
    expect(await screen.findByText(/💬 falhou/)).toBeInTheDocument();
  });

  it("shows a generic error answer when asking rejects with a non-Error", async () => {
    api.askSummary.mockRejectedValue("x");
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Entre 08:00/);
    await user.type(screen.getByLabelText("pergunta"), "x");
    await user.click(screen.getByRole("button", { name: "Perguntar" }));
    expect(await screen.findByText(/Erro ao perguntar/)).toBeInTheDocument();
  });

  it("omits the breakdown when there are no events", async () => {
    api.getDaySummary.mockResolvedValue({
      ...FULL,
      total: 0,
      by_camera: [],
      by_label: [],
      text: "Nenhum evento registrado hoje.",
    });
    renderPage();
    expect(await screen.findByText("Nenhum evento registrado hoje.")).toBeInTheDocument();
    expect(screen.queryByText(/2× aberto/)).not.toBeInTheDocument();
  });

  it("navigates back home", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "← Voltar" }));
    expect(nav).toHaveBeenCalledWith("/");
  });

  it("shows an error when loading fails", async () => {
    api.getDaySummary.mockRejectedValue(new Error("backend fora"));
    renderPage();
    expect(await screen.findByText("backend fora")).toBeInTheDocument();
  });

  it("shows a generic error when loading rejects with a non-Error", async () => {
    api.getDaySummary.mockRejectedValue("x");
    renderPage();
    expect(await screen.findByText("Erro ao carregar")).toBeInTheDocument();
  });
});
