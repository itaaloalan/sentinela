import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Vigilante from "./Vigilante";

const api = {
  getVigilanteConfig: vi.fn(),
  listObservations: vi.fn(),
  setVigilante: vi.fn(),
};
const nav = vi.fn();
vi.mock("../lib/api", () => ({
  getVigilanteConfig: (...a: unknown[]) => api.getVigilanteConfig(...a),
  listObservations: (...a: unknown[]) => api.listObservations(...a),
  setVigilante: (...a: unknown[]) => api.setVigilante(...a),
  observationSnapshotUrl: (id: number) => `/api/observations/${id}/snapshot?token=`,
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => nav };
});

const OBS = [
  { id: 1, camera_id: 1, description: "Detectado: 1 pessoa.", objects: ["person"], snapshot: "a.jpg", created_at: "2026-06-01T22:13:00+00:00" },
  { id: 2, camera_id: 1, description: "Detectado: 1 carro.", objects: ["car"], snapshot: null, created_at: "2026-06-01T22:10:00+00:00" },
];

beforeEach(() => {
  api.getVigilanteConfig.mockReset().mockResolvedValue({ enabled: false });
  api.listObservations.mockReset().mockResolvedValue(OBS);
  api.setVigilante.mockReset().mockResolvedValue({ enabled: true });
  nav.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Vigilante />
    </MemoryRouter>,
  );
}

describe("Vigilante", () => {
  it("lists observations and renders a thumbnail only when a snapshot exists", async () => {
    renderPage();
    expect(await screen.findByText("Detectado: 1 pessoa.")).toBeInTheDocument();
    expect(screen.getByText("Detectado: 1 carro.")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1); // só a obs com snapshot
  });

  it("shows the empty state when there are no observations", async () => {
    api.listObservations.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Nenhuma observação ainda/)).toBeInTheDocument();
  });

  it("starts off and turns the mode on", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Detectado: 1 pessoa.");
    expect(screen.getByText(/Desligado/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ligar" }));
    expect(await screen.findByText(/Ligado/)).toBeInTheDocument();
    expect(api.setVigilante).toHaveBeenCalledWith(true);
  });

  it("reflects an already-on config and can turn it off", async () => {
    api.getVigilanteConfig.mockResolvedValue({ enabled: true });
    api.setVigilante.mockResolvedValue({ enabled: false });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText(/Ligado/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Desligar" }));
    await waitFor(() => expect(api.setVigilante).toHaveBeenCalledWith(false));
  });

  it("falls back to off when the config fetch fails", async () => {
    api.getVigilanteConfig.mockRejectedValue(new Error("x"));
    renderPage();
    expect(await screen.findByText(/Desligado/)).toBeInTheDocument();
  });

  it("shows an error when toggling fails (Error)", async () => {
    api.setVigilante.mockRejectedValue(new Error("sem rede"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Detectado: 1 pessoa.");
    await user.click(screen.getByRole("button", { name: "Ligar" }));
    expect(await screen.findByText("sem rede")).toBeInTheDocument();
  });

  it("shows a generic error when toggling rejects with a non-Error", async () => {
    api.setVigilante.mockRejectedValue("x");
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Detectado: 1 pessoa.");
    await user.click(screen.getByRole("button", { name: "Ligar" }));
    expect(await screen.findByText("Erro ao alternar")).toBeInTheDocument();
  });

  it("shows an error when listing fails (Error)", async () => {
    api.listObservations.mockRejectedValue(new Error("falha lista"));
    renderPage();
    expect(await screen.findByText("falha lista")).toBeInTheDocument();
  });

  it("shows a generic error when listing rejects with a non-Error", async () => {
    api.listObservations.mockRejectedValue("x");
    renderPage();
    expect(await screen.findByText("Erro ao carregar")).toBeInTheDocument();
  });

  it("navigates back home", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "← Voltar" }));
    expect(nav).toHaveBeenCalledWith("/");
  });
});
