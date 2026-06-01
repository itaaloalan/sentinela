import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Notifications from "./Notifications";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

const api = {
  getNotifyConfig: vi.fn(),
  setNotifyTopic: vi.fn(),
  sendTestNotification: vi.fn(),
};
vi.mock("../lib/api", () => ({
  getNotifyConfig: (...a: unknown[]) => api.getNotifyConfig(...a),
  setNotifyTopic: (...a: unknown[]) => api.setNotifyTopic(...a),
  sendTestNotification: (...a: unknown[]) => api.sendTestNotification(...a),
}));

const CFG = {
  server: "https://ntfy.sh",
  topic: "sentinela-a7f3k9x2-portao",
  app_public_url: "http://100.64.0.1:5173",
  configured: true,
};

beforeEach(() => {
  navigate.mockReset();
  api.getNotifyConfig.mockReset().mockResolvedValue(CFG);
  api.setNotifyTopic.mockReset().mockResolvedValue(CFG);
  api.sendTestNotification.mockReset().mockResolvedValue({ sent: true, topic: CFG.topic });
});

describe("Notifications", () => {
  it("prefills the current topic and server", async () => {
    render(<Notifications />);
    expect(await screen.findByDisplayValue("sentinela-a7f3k9x2-portao")).toBeInTheDocument();
    expect(screen.getAllByText("https://ntfy.sh").length).toBeGreaterThan(0);
    // tópico configurado e sem edição → Salvar desabilitado, sem aviso
    expect(screen.getByRole("button", { name: "Salvar tópico" })).toBeDisabled();
    expect(screen.queryByText(/não salva/)).toBeNull();
  });

  it("warns when the topic is still a placeholder/insecure", async () => {
    api.getNotifyConfig.mockResolvedValue({ ...CFG, configured: false });
    render(<Notifications />);
    expect(await screen.findByText(/placeholder ou é curto/)).toBeInTheDocument();
  });

  it("generates a valid random topic and enables saving", async () => {
    const user = userEvent.setup();
    render(<Notifications />);
    await screen.findByDisplayValue(CFG.topic);
    await user.click(screen.getByRole("button", { name: "Gerar aleatório" }));
    const input = screen.getByLabelText(/Tópico/) as HTMLInputElement;
    expect(input.value).toMatch(/^sentinela-[0-9a-f]{24}$/);
    expect(screen.getByText("alteração não salva")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar tópico" })).not.toBeDisabled();
  });

  it("saves the new topic", async () => {
    const novo = { ...CFG, topic: "sentinela-novo-1234567890" };
    api.setNotifyTopic.mockResolvedValue(novo);
    const user = userEvent.setup();
    render(<Notifications />);
    const input = await screen.findByLabelText(/Tópico/);
    await user.clear(input);
    await user.type(input, "sentinela-novo-1234567890");
    await user.click(screen.getByRole("button", { name: "Salvar tópico" }));
    expect(api.setNotifyTopic).toHaveBeenCalledWith("sentinela-novo-1234567890");
    // pós-save: não está mais "sujo"
    expect(await screen.findByDisplayValue("sentinela-novo-1234567890")).toBeInTheDocument();
    expect(screen.queryByText("alteração não salva")).toBeNull();
  });

  it("shows the save error", async () => {
    api.setNotifyTopic.mockRejectedValue(new Error("tópico inválido"));
    const user = userEvent.setup();
    render(<Notifications />);
    const input = await screen.findByLabelText(/Tópico/);
    await user.type(input, "x"); // torna sujo
    await user.click(screen.getByRole("button", { name: "Salvar tópico" }));
    expect(await screen.findByText("tópico inválido")).toBeInTheDocument();
  });

  it("sends a test notification via the backend", async () => {
    const user = userEvent.setup();
    render(<Notifications />);
    await screen.findByDisplayValue(CFG.topic);
    await user.click(screen.getByRole("button", { name: "Enviar teste" }));
    expect(api.sendTestNotification).toHaveBeenCalled();
    expect(await screen.findByText(/veja a notificação no celular/)).toBeInTheDocument();
  });

  it("shows a generic error when sending the test fails (non-Error)", async () => {
    api.sendTestNotification.mockRejectedValue("x");
    const user = userEvent.setup();
    render(<Notifications />);
    await screen.findByDisplayValue(CFG.topic);
    await user.click(screen.getByRole("button", { name: "Enviar teste" }));
    expect(await screen.findByText("Erro")).toBeInTheDocument();
  });

  it("copies the current topic and resets the label", async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      render(<Notifications />);
      await act(async () => {});
      await act(async () => {
        screen.getByRole("button", { name: "copiar atual" }).click();
      });
      expect(writeText).toHaveBeenCalledWith(CFG.topic);
      expect(screen.getByRole("button", { name: "copiado ✓" })).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByRole("button", { name: "copiar atual" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("shows the load error message (Error)", async () => {
    api.getNotifyConfig.mockRejectedValue(new Error("falhou"));
    render(<Notifications />);
    expect(await screen.findByText("falhou")).toBeInTheDocument();
  });

  it("shows a generic load error on a non-Error rejection", async () => {
    api.getNotifyConfig.mockRejectedValue("x");
    render(<Notifications />);
    expect(await screen.findByText("Erro")).toBeInTheDocument();
  });

  it("navigates back to the cameras grid", async () => {
    const user = userEvent.setup();
    render(<Notifications />);
    await user.click(await screen.findByRole("button", { name: "← Câmeras" }));
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
