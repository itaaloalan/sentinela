import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Events from "./Events";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

const api = { listEvents: vi.fn() };
vi.mock("../lib/api", () => ({
  listEvents: (...a: unknown[]) => api.listEvents(...a),
  eventSnapshotUrl: (id: number) => `/api/events/${id}/snapshot?token=`,
}));

beforeEach(() => {
  navigate.mockReset();
  api.listEvents.mockReset().mockResolvedValue([]);
});

describe("Events", () => {
  it("shows the empty state", async () => {
    render(<Events />);
    expect(await screen.findByText(/Nenhum alerta ainda/)).toBeInTheDocument();
  });

  it("lists alert events with snapshot and label", async () => {
    api.listEvents.mockResolvedValue([
      { id: 1, model_id: 1, camera_id: 1, label: "aberto", snapshot: "s.jpg", created_at: "2026-06-01T10:00:00+00:00" },
    ]);
    render(<Events />);
    expect(await screen.findByAltText("aberto")).toBeInTheDocument();
    expect(screen.getByText("aberto")).toBeInTheDocument();
  });

  it("shows the error message on failure (Error)", async () => {
    api.listEvents.mockRejectedValue(new Error("falhou"));
    render(<Events />);
    expect(await screen.findByText("falhou")).toBeInTheDocument();
  });

  it("shows a generic error on a non-Error rejection", async () => {
    api.listEvents.mockRejectedValue("x");
    render(<Events />);
    expect(await screen.findByText("Erro")).toBeInTheDocument();
  });

  it("navigates back to the cameras grid", async () => {
    const user = userEvent.setup();
    render(<Events />);
    await user.click(await screen.findByRole("button", { name: "← Câmeras" }));
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
