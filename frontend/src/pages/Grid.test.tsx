import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Grid from "./Grid";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

const api = {
  auth: { logout: vi.fn() },
  listCameras: vi.fn(),
  createCamera: vi.fn(),
  deleteCamera: vi.fn(),
  snapshotUrl: (id: number) => `/api/cameras/${id}/snapshot`,
};
vi.mock("../lib/api", () => ({
  auth: { logout: (...a: unknown[]) => api.auth.logout(...a) },
  listCameras: (...a: unknown[]) => api.listCameras(...a),
  createCamera: (...a: unknown[]) => api.createCamera(...a),
  deleteCamera: (...a: unknown[]) => api.deleteCamera(...a),
  snapshotUrl: (id: number) => api.snapshotUrl(id),
}));

const ONE = [{ id: 1, name: "portao", source: "rtsp://x", kind: "rtsp", ptz_enabled: false }];

beforeEach(() => {
  navigate.mockReset();
  api.auth.logout.mockReset();
  api.listCameras.mockReset().mockResolvedValue([]);
  api.createCamera.mockReset().mockResolvedValue(ONE[0]);
  api.deleteCamera.mockReset().mockResolvedValue(undefined);
});

describe("Grid", () => {
  it("shows the empty state when there are no cameras", async () => {
    render(<Grid />);
    expect(await screen.findByText(/Nenhuma câmera cadastrada/)).toBeInTheDocument();
  });

  it("lists cameras loaded from the API", async () => {
    api.listCameras.mockResolvedValue(ONE);
    render(<Grid />);
    expect(await screen.findByText("portao")).toBeInTheDocument();
  });

  it("shows an error when loading fails (Error)", async () => {
    api.listCameras.mockRejectedValue(new Error("falhou"));
    render(<Grid />);
    expect(await screen.findByText("falhou")).toBeInTheDocument();
  });

  it("shows a generic error when loading rejects with a non-Error", async () => {
    api.listCameras.mockRejectedValue("x");
    render(<Grid />);
    expect(await screen.findByText("Erro")).toBeInTheDocument();
  });

  it("creates a camera and refreshes", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    api.listCameras.mockResolvedValue(ONE);
    await user.type(screen.getByPlaceholderText(/nome/), "portao");
    await user.type(screen.getByPlaceholderText(/source/), "rtsp://x");
    await user.selectOptions(screen.getByLabelText("tipo"), "dvrip");
    await user.click(screen.getByLabelText("PTZ"));
    await user.click(screen.getByRole("button", { name: /Cadastrar/ }));
    await waitFor(() =>
      expect(api.createCamera).toHaveBeenCalledWith({
        name: "portao",
        source: "rtsp://x",
        kind: "dvrip",
        ptz_enabled: true,
      }),
    );
    expect(await screen.findByText("portao")).toBeInTheDocument();
  });

  it("shows an error when creating fails", async () => {
    api.createCamera.mockRejectedValue(new Error("dup"));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await user.type(screen.getByPlaceholderText(/nome/), "portao");
    await user.type(screen.getByPlaceholderText(/source/), "rtsp://x");
    await user.click(screen.getByRole("button", { name: /Cadastrar/ }));
    expect(await screen.findByText("dup")).toBeInTheDocument();
  });

  it("shows a generic error when creating rejects with a non-Error", async () => {
    api.createCamera.mockRejectedValue("x");
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await user.type(screen.getByPlaceholderText(/nome/), "portao");
    await user.type(screen.getByPlaceholderText(/source/), "rtsp://x");
    await user.click(screen.getByRole("button", { name: /Cadastrar/ }));
    expect(await screen.findByText("Erro ao cadastrar")).toBeInTheDocument();
  });

  it("shows progress text while saving", async () => {
    let resolve!: (v: unknown) => void;
    api.createCamera.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await user.type(screen.getByPlaceholderText(/nome/), "portao");
    await user.type(screen.getByPlaceholderText(/source/), "rtsp://x");
    await user.click(screen.getByRole("button", { name: /Salvando|Cadastrar/ }));
    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    resolve(ONE[0]);
  });

  it("deletes a camera and refreshes", async () => {
    api.listCameras.mockResolvedValue(ONE);
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("portao");
    api.listCameras.mockResolvedValue([]);
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(api.deleteCamera).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/Nenhuma câmera/)).toBeInTheDocument();
  });

  it("shows an error when deleting fails", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.deleteCamera.mockRejectedValue(new Error("nao deu"));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("portao");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(await screen.findByText("nao deu")).toBeInTheDocument();
  });

  it("shows a generic error when deleting rejects with a non-Error", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.deleteCamera.mockRejectedValue("x");
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("portao");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(await screen.findByText("Erro ao excluir")).toBeInTheDocument();
  });

  it("hides a snapshot image that fails to load", async () => {
    api.listCameras.mockResolvedValue(ONE);
    render(<Grid />);
    const img = (await screen.findByAltText("portao")) as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.display).toBe("none");
  });

  it("logs out and navigates to /login", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await user.click(screen.getByRole("button", { name: "Sair" }));
    expect(api.auth.logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});
