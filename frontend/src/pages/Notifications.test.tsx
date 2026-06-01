import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Notifications from "./Notifications";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

const api = { getNotifyConfig: vi.fn() };
vi.mock("../lib/api", () => ({
  getNotifyConfig: (...a: unknown[]) => api.getNotifyConfig(...a),
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
});

describe("Notifications", () => {
  it("shows the topic, server and test command", async () => {
    render(<Notifications />);
    expect(await screen.findByText("sentinela-a7f3k9x2-portao")).toBeInTheDocument();
    expect(
      screen.getByText(/curl -d "teste do sentinela" https:\/\/ntfy.sh\/sentinela-a7f3k9x2-portao/),
    ).toBeInTheDocument();
    // tópico configurado → sem aviso de placeholder
    expect(screen.queryByText(/placeholder/)).toBeNull();
  });

  it("warns when the topic is still a placeholder/insecure", async () => {
    api.getNotifyConfig.mockResolvedValue({ ...CFG, configured: false });
    render(<Notifications />);
    expect(await screen.findByText(/placeholder ou é curto/)).toBeInTheDocument();
  });

  it("copies the topic to the clipboard and resets the label", async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      render(<Notifications />);
      await act(async () => {}); // resolve o getNotifyConfig
      await act(async () => {
        screen.getByRole("button", { name: "copiar" }).click();
      });
      expect(writeText).toHaveBeenCalledWith("sentinela-a7f3k9x2-portao");
      expect(screen.getByRole("button", { name: "copiado ✓" })).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(1500); // volta o rótulo
      });
      expect(screen.getByRole("button", { name: "copiar" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("shows the error message on failure (Error)", async () => {
    api.getNotifyConfig.mockRejectedValue(new Error("falhou"));
    render(<Notifications />);
    expect(await screen.findByText("falhou")).toBeInTheDocument();
  });

  it("shows a generic error on a non-Error rejection", async () => {
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
