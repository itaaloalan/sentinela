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
  updateCamera: vi.fn(),
  deleteCamera: vi.fn(),
  discoverCameras: vi.fn(),
  recordView: vi.fn(),
  getOverview: vi.fn(),
  listEvents: vi.fn(),
};
vi.mock("../lib/api", () => ({
  auth: { logout: (...a: unknown[]) => api.auth.logout(...a) },
  listCameras: (...a: unknown[]) => api.listCameras(...a),
  createCamera: (...a: unknown[]) => api.createCamera(...a),
  updateCamera: (...a: unknown[]) => api.updateCamera(...a),
  deleteCamera: (...a: unknown[]) => api.deleteCamera(...a),
  discoverCameras: (...a: unknown[]) => api.discoverCameras(...a),
  recordView: (...a: unknown[]) => api.recordView(...a),
  getOverview: (...a: unknown[]) => api.getOverview(...a),
  listEvents: (...a: unknown[]) => api.listEvents(...a),
  streamWsUrl: (name: string) => `ws://localhost/go2rtc/api/ws?src=${name}`,
  snapshotUrl: (id: number) => `/api/cameras/${id}/snapshot?token=`,
  ptzMove: vi.fn(),
}));

const FOUND = {
  subnet: "192.168.0.0/24",
  scanned: 254,
  reachable: [{ ip: "192.168.0.12", ports: [554] }],
  candidates: [
    {
      ip: "192.168.0.12", mac: "14:5d:34:ec:04:f9", vendor: "Bilian",
      ports: [554], kind: "rtsp",
      suggested_source: "rtsp://admin:SENHA@192.168.0.12:554/onvif1", label: "RTSP",
    },
  ],
};

const ONE = [{ id: 1, name: "portao", source: "rtsp://x", kind: "rtsp", ptz_enabled: false }];

// o formulário e o "Descobrir" agora ficam atrás do menu de ações (☰ →
// ➕ Adicionar câmera). Helper que abre o menu e revela o formulário.
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Menu de ações" }));
  await user.click(screen.getByRole("button", { name: /Adicionar câmera/ }));
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Menu de ações" }));
}

beforeEach(() => {
  navigate.mockReset();
  api.auth.logout.mockReset();
  api.listCameras.mockReset().mockResolvedValue([]);
  api.createCamera.mockReset().mockResolvedValue(ONE[0]);
  api.updateCamera.mockReset().mockResolvedValue(ONE[0]);
  api.deleteCamera.mockReset().mockResolvedValue(undefined);
  api.discoverCameras.mockReset().mockResolvedValue(FOUND);
  api.recordView.mockReset().mockResolvedValue(undefined);
  api.getOverview.mockReset().mockResolvedValue({ cameras: [], events_today: 0, disk_percent: null });
  api.listEvents.mockReset().mockResolvedValue([]);
});

describe("Grid", () => {
  it("shows the empty state when there are no cameras", async () => {
    render(<Grid />);
    expect(await screen.findByText(/Nenhuma câmera cadastrada/)).toBeInTheDocument();
  });

  it("lists cameras loaded from the API", async () => {
    api.listCameras.mockResolvedValue(ONE);
    render(<Grid />);
    expect(await screen.findByText("📷 portao")).toBeInTheDocument();
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
    await openForm(user);
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
    expect(await screen.findByText("📷 portao")).toBeInTheDocument();
  });

  it("replaces SENHA in the source with the typed password", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
    await user.type(screen.getByPlaceholderText(/nome/), "portao");
    await user.type(
      screen.getByPlaceholderText(/source/),
      "rtsp://admin:SENHA@192.168.0.12:554/onvif1",
    );
    await user.type(screen.getByPlaceholderText(/senha/), "qwerty123");
    await user.click(screen.getByRole("button", { name: /Cadastrar/ }));
    await waitFor(() =>
      expect(api.createCamera).toHaveBeenCalledWith({
        name: "portao",
        source: "rtsp://admin:qwerty123@192.168.0.12:554/onvif1",
        kind: "rtsp",
        ptz_enabled: false,
      }),
    );
  });

  it("edits a camera via the Editar button", async () => {
    api.listCameras.mockResolvedValue(ONE);
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("📷 portao");
    await user.click(screen.getByRole("button", { name: "Opções de portao" }));
    await user.click(screen.getByRole("button", { name: "Editar" }));
    expect((screen.getByPlaceholderText(/nome/) as HTMLInputElement).value).toBe("portao");
    expect((screen.getByPlaceholderText(/source/) as HTMLInputElement).value).toBe("rtsp://x");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    const src = screen.getByPlaceholderText(/source/);
    await user.clear(src);
    await user.type(src, "rtsp://nova");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(api.updateCamera).toHaveBeenCalledWith(1, {
        name: "portao",
        source: "rtsp://nova",
        kind: "rtsp",
        ptz_enabled: false,
      }),
    );
  });

  it("cancels editing and restores the create form", async () => {
    api.listCameras.mockResolvedValue(ONE);
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("📷 portao");
    await user.click(screen.getByRole("button", { name: "Opções de portao" }));
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect((screen.getByPlaceholderText(/nome/) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Cadastrar câmera" })).toBeInTheDocument();
  });

  it("shows an error when creating fails", async () => {
    api.createCamera.mockRejectedValue(new Error("dup"));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
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
    await openForm(user);
    await user.type(screen.getByPlaceholderText(/nome/), "portao");
    await user.type(screen.getByPlaceholderText(/source/), "rtsp://x");
    await user.click(screen.getByRole("button", { name: /Cadastrar/ }));
    expect(await screen.findByText("Erro ao salvar a câmera")).toBeInTheDocument();
  });

  it("shows progress text while saving", async () => {
    let resolve!: (v: unknown) => void;
    api.createCamera.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
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
    await screen.findByText("📷 portao");
    api.listCameras.mockResolvedValue([]);
    await user.click(screen.getByRole("button", { name: "Opções de portao" }));
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(api.deleteCamera).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/Nenhuma câmera/)).toBeInTheDocument();
  });

  it("shows an error when deleting fails", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.deleteCamera.mockRejectedValue(new Error("nao deu"));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("📷 portao");
    await user.click(screen.getByRole("button", { name: "Opções de portao" }));
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(await screen.findByText("nao deu")).toBeInTheDocument();
  });

  it("shows a generic error when deleting rejects with a non-Error", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.deleteCamera.mockRejectedValue("x");
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("📷 portao");
    await user.click(screen.getByRole("button", { name: "Opções de portao" }));
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(await screen.findByText("Erro ao excluir")).toBeInTheDocument();
  });

  it("discovers cameras, logs the scan, and prefills the form when clicking Usar", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
    await user.click(screen.getByRole("button", { name: "Descobrir" }));
    expect(await screen.findByText(/254 IPs varridos/)).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.0\.12 — portas 554/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Usar" }));
    expect((screen.getByPlaceholderText(/nome/) as HTMLInputElement).value).toBe("12");
    expect((screen.getByPlaceholderText(/source/) as HTMLInputElement).value).toBe(
      "rtsp://admin:SENHA@192.168.0.12:554/onvif1",
    );
    expect((screen.getByLabelText("tipo") as HTMLSelectElement).value).toBe("rtsp");
  });

  it("logs a hint when discovery finds no cameras", async () => {
    api.discoverCameras.mockResolvedValue({
      subnet: "192.168.0.0/24",
      scanned: 254,
      reachable: [{ ip: "192.168.0.1", ports: [80] }],
      candidates: [],
    });
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
    await user.click(screen.getByRole("button", { name: "Descobrir" }));
    expect(
      await screen.findByText(/Nenhuma câmera respondeu nas portas RTSP\/DVRIP/),
    ).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.0\.1 — portas 80/)).toBeInTheDocument();
  });

  it("shows progress text while discovering", async () => {
    let resolve!: (v: unknown) => void;
    api.discoverCameras.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
    await user.click(screen.getByRole("button", { name: "Descobrir" }));
    expect(await screen.findByRole("button", { name: "Procurando…" })).toBeDisabled();
    resolve(FOUND);
  });

  it("shows an error when discovery fails", async () => {
    api.discoverCameras.mockRejectedValue(new Error("scan falhou"));
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
    await user.click(screen.getByRole("button", { name: "Descobrir" }));
    expect(await screen.findByText("scan falhou")).toBeInTheDocument();
  });

  it("shows a generic error when discovery rejects with a non-Error", async () => {
    api.discoverCameras.mockRejectedValue("x");
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openForm(user);
    await user.click(screen.getByRole("button", { name: "Descobrir" }));
    expect(await screen.findByText("Erro ao descobrir")).toBeInTheDocument();
  });

  it("navigates to the training page", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "🧠 Treinos" }));
    expect(navigate).toHaveBeenCalledWith("/treinos");
  });

  it("navigates to the events page", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "🔔 Eventos" }));
    expect(navigate).toHaveBeenCalledWith("/eventos");
  });

  it("navigates to the notifications page", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "📲 Notificações" }));
    expect(navigate).toHaveBeenCalledWith("/notificacoes");
  });

  it("navigates to the summary page", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "📋 Resumo" }));
    expect(navigate).toHaveBeenCalledWith("/resumo");
  });

  it("navigates home from the menu", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "🏠 Início" }));
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("navigates to the family page", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "👨‍👩‍👧 Família" }));
    expect(navigate).toHaveBeenCalledWith("/familia");
  });

  it("records a dashboard view on mount", async () => {
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await waitFor(() => expect(api.recordView).toHaveBeenCalledWith(null));
  });

  it("navigates to the vigilante page", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "👁 Vigilante" }));
    expect(navigate).toHaveBeenCalledWith("/vigilante");
  });

  it("navigates to the health page", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "❤️ Saúde" }));
    expect(navigate).toHaveBeenCalledWith("/saude");
  });

  const TWO = [
    ONE[0],
    { id: 2, name: "quintal", source: "rtsp://y", kind: "rtsp", ptz_enabled: false },
  ];

  it("shows the stats bar, online status and last event", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.getOverview.mockResolvedValue({
      cameras: [{ name: "portao", online: true }],
      events_today: 17,
      disk_percent: 78,
    });
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    api.listEvents.mockResolvedValue([
      { id: 1, model_id: 1, camera_id: 1, label: "aberto", snapshot: "s", created_at: fiveMinAgo },
    ]);
    const { container } = render(<Grid />);
    // produtor ativo no go2rtc mas player ainda sem tocar → Conectando
    expect(await screen.findByText("🟡 Conectando")).toBeInTheDocument();
    fireEvent(container.querySelector("video-stream")!, new Event("playing"));
    expect(await screen.findByText("🟢 Online")).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("há 5 min")).toBeInTheDocument();
    expect(screen.getByText(/Último evento:/)).toBeInTheDocument();
  });

  it("opens the event history from a card", async () => {
    api.listCameras.mockResolvedValue(ONE);
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("📷 portao");
    await user.click(screen.getByRole("button", { name: "🎥 Ver histórico" }));
    expect(navigate).toHaveBeenCalledWith("/eventos");
  });

  it("shows offline status", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.getOverview.mockResolvedValue({ cameras: [{ name: "portao", online: false }], events_today: 0, disk_percent: null });
    render(<Grid />);
    expect(await screen.findByText("🔴 Offline")).toBeInTheDocument();
  });

  it("shows reconnecting status while overview is unavailable", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.getOverview.mockRejectedValue(new Error("x"));
    render(<Grid />);
    expect(await screen.findByText("🟡 Conectando")).toBeInTheDocument();
  });

  it("shows 'agora' and 'há N h' for the last movement", async () => {
    api.listCameras.mockResolvedValue(ONE);
    api.listEvents.mockResolvedValue([
      { id: 1, model_id: 1, camera_id: 9, label: "x", snapshot: "s", created_at: new Date().toISOString() },
    ]);
    const { unmount } = render(<Grid />);
    expect(await screen.findByText("agora")).toBeInTheDocument();
    unmount();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    api.listEvents.mockResolvedValue([
      { id: 2, model_id: 1, camera_id: 9, label: "x", snapshot: "s", created_at: twoHoursAgo },
    ]);
    render(<Grid />);
    expect(await screen.findByText("há 2 h")).toBeInTheDocument();
  });

  it("toggles the three-dot card menu", async () => {
    api.listCameras.mockResolvedValue(ONE);
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("📷 portao");
    await user.click(screen.getByRole("button", { name: "Opções de portao" }));
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Opções de portao" }));
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("switches to monitoring mode and picks a camera from the strip", async () => {
    api.listCameras.mockResolvedValue(TWO);
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText("📷 portao");
    await user.click(screen.getByRole("button", { name: "▢ Monitoramento" }));
    const thumbs = screen.getAllByRole("img");
    expect(thumbs.length).toBe(2);
    await user.click(screen.getByRole("button", { name: /quintal/ }));
    // de volta para a grade
    await user.click(screen.getByRole("button", { name: "▦ Grade" }));
    expect(await screen.findByText("📷 quintal")).toBeInTheDocument();
  });

  it("logs out and navigates to /login", async () => {
    const user = userEvent.setup();
    render(<Grid />);
    await screen.findByText(/Nenhuma câmera/);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "🚪 Sair" }));
    expect(api.auth.logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});
