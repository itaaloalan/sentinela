import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Training from "./Training";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

vi.mock("../components/CameraVideo", () => ({
  CameraVideo: () => <div data-testid="cam-video" />,
}));

const api = {
  listModels: vi.fn(),
  listCameras: vi.fn(),
  createModel: vi.fn(),
  captureFrame: vi.fn(),
  listModelFrames: vi.fn(),
  deleteModelFrame: vi.fn(),
  setModelCrop: vi.fn(),
  trainModel: vi.fn(),
  testModel: vi.fn(),
  activateModel: vi.fn(),
  updateModel: vi.fn(),
};
vi.mock("../lib/api", () => ({
  auth: {},
  listModels: (...a: unknown[]) => api.listModels(...a),
  listCameras: (...a: unknown[]) => api.listCameras(...a),
  createModel: (...a: unknown[]) => api.createModel(...a),
  captureFrame: (...a: unknown[]) => api.captureFrame(...a),
  listModelFrames: (...a: unknown[]) => api.listModelFrames(...a),
  deleteModelFrame: (...a: unknown[]) => api.deleteModelFrame(...a),
  setModelCrop: (...a: unknown[]) => api.setModelCrop(...a),
  trainModel: (...a: unknown[]) => api.trainModel(...a),
  testModel: (...a: unknown[]) => api.testModel(...a),
  activateModel: (...a: unknown[]) => api.activateModel(...a),
  updateModel: (...a: unknown[]) => api.updateModel(...a),
  modelFrameUrl: (id: number, label: string, f: string) =>
    `/api/models/${id}/frames/${label}/${f}?token=`,
}));

// modelo 1: câmera existente, crop, accuracy, ativo, frames cheios
// modelo 2: câmera inexistente (sem preview), crop null, accuracy null, inativo
const M1 = {
  id: 1, camera_id: 1, name: "portao", classes: ["aberto", "fechado"],
  alert_label: "aberto", debounce_seconds: 45,
  crop: { x1: 1, y1: 2, x2: 3, y2: 4 }, version: 1, accuracy: 0.9,
  active: true, status: "pronto", frames: { aberto: 2, fechado: 1 },
};
const M2 = {
  id: 2, camera_id: 99, name: "vazio", classes: ["aberto", "fechado"],
  alert_label: "aberto", debounce_seconds: 45,
  crop: null, version: 0, accuracy: null, active: false, status: "novo",
  frames: { aberto: 0 },
};
const CAMERAS = [{ id: 1, name: "portao", source: "rtsp://x", kind: "rtsp", ptz_enabled: false }];

beforeEach(() => {
  navigate.mockReset();
  api.listModels.mockReset().mockResolvedValue([M1, M2]);
  api.listCameras.mockReset().mockResolvedValue(CAMERAS);
  api.createModel.mockReset().mockResolvedValue(M1);
  api.captureFrame.mockReset().mockResolvedValue({ frames: 1 });
  api.listModelFrames.mockReset().mockResolvedValue({ aberto: ["f1.jpg"] });
  api.deleteModelFrame.mockReset().mockResolvedValue(undefined);
  api.setModelCrop.mockReset().mockResolvedValue(M1);
  api.trainModel.mockReset().mockResolvedValue({ status: "treinando" });
  api.testModel.mockReset().mockResolvedValue({ label: "aberto", confidence: 0.87 });
  api.activateModel.mockReset().mockResolvedValue({ active: false });
  api.updateModel.mockReset().mockResolvedValue(M1);
});

describe("Training", () => {
  it("lists models and cameras", async () => {
    render(<Training />);
    expect(await screen.findByText(/portao · pronto/)).toBeInTheDocument();
    expect(screen.getByText(/vazio · novo/)).toBeInTheDocument();
  });

  it("shows a generic error when loading rejects with a non-Error", async () => {
    api.listModels.mockRejectedValue("x");
    render(<Training />);
    expect(await screen.findByText("Erro")).toBeInTheDocument();
  });

  it("shows the message when loading fails with an Error", async () => {
    api.listModels.mockRejectedValue(new Error("falhou"));
    render(<Training />);
    expect(await screen.findByText("falhou")).toBeInTheDocument();
  });

  it("creates a model and selects it", async () => {
    const created = { ...M1, id: 7, name: "novo" };
    api.createModel.mockResolvedValue(created);
    api.listModels.mockResolvedValue([created]);
    const user = userEvent.setup();
    render(<Training />);
    await screen.findByRole("button", { name: "Criar modelo" });
    await user.clear(screen.getByPlaceholderText(/nome do modelo/));
    await user.type(screen.getByPlaceholderText(/nome do modelo/), "novo");
    await user.selectOptions(screen.getByLabelText("câmera"), "1");
    await user.selectOptions(screen.getByLabelText("câmera"), ""); // volta p/ vazio
    await user.selectOptions(screen.getByLabelText("câmera"), "1");
    await user.click(screen.getByRole("button", { name: "Criar modelo" }));
    await waitFor(() =>
      expect(api.createModel).toHaveBeenCalledWith(1, "novo", ["aberto", "fechado"], "aberto"),
    );
    expect(await screen.findByLabelText("nome do modelo")).toHaveValue("novo");
  });

  it("creates a model with custom classes (ex.: vazamento)", async () => {
    const created = { ...M1, id: 9, name: "pia", classes: ["vazamento", "seco"], alert_label: "vazamento" };
    api.createModel.mockResolvedValue(created);
    api.listModels.mockResolvedValue([created]);
    const user = userEvent.setup();
    render(<Training />);
    await screen.findByRole("button", { name: "Criar modelo" });
    await user.clear(screen.getByPlaceholderText(/nome do modelo/));
    await user.type(screen.getByPlaceholderText(/nome do modelo/), "pia");
    await user.selectOptions(screen.getByLabelText("câmera"), "1");
    await user.clear(screen.getByLabelText("classes"));
    await user.type(screen.getByLabelText("classes"), "vazamento, seco");
    await user.click(screen.getByRole("button", { name: "Criar modelo" }));
    await waitFor(() =>
      expect(api.createModel).toHaveBeenCalledWith(1, "pia", ["vazamento", "seco"], "vazamento"),
    );
  });

  it("renames the selected model", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    const input = await screen.findByLabelText("nome do modelo");
    await user.clear(input);
    await user.type(input, "portão da frente");
    await user.click(screen.getByRole("button", { name: "Renomear" }));
    await waitFor(() =>
      expect(api.updateModel).toHaveBeenCalledWith(1, { name: "portão da frente" }),
    );
  });

  it("saves the alert config (label + debounce)", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    await user.selectOptions(await screen.findByLabelText("classe de alerta"), "fechado");
    const secs = screen.getByLabelText("segundos de espera");
    await user.clear(secs);
    await user.type(secs, "120");
    await user.click(screen.getByRole("button", { name: "Salvar alerta" }));
    await waitFor(() =>
      expect(api.updateModel).toHaveBeenCalledWith(1, { alert_label: "fechado", debounce_seconds: 120 }),
    );
  });

  it("selects model 1: live preview, gallery and active toggle", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    expect(await screen.findByTestId("cam-video")).toBeInTheDocument();
    expect(screen.getByAltText("f1.jpg")).toBeInTheDocument(); // thumb da galeria
    expect(screen.getByRole("button", { name: "Desativar alerta" })).toBeInTheDocument();
    expect(screen.getByText(/acurácia 90%/)).toBeInTheDocument();
    expect(screen.getByText(/Monitor ligado/)).toBeInTheDocument();
    expect(screen.getByText(/Treina o classificador com os 3 frames/)).toBeInTheDocument();
  });

  it("trained + inactive model: alert can be activated, with hints", async () => {
    const pronto = { ...M1, active: false };
    api.listModels.mockResolvedValue([pronto]);
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    const ativar = await screen.findByRole("button", { name: "3. Ativar alerta" });
    expect(ativar).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "2. Testar ao vivo" })).not.toBeDisabled();
    expect(screen.getByText(/Liga o monitor que dispara o alerta/)).toBeInTheDocument();
  });

  it("shows the error reason in the status badge", async () => {
    const erro = { ...M1, status: "erro: sem ultralytics" };
    api.listModels.mockResolvedValue([erro]);
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · erro/));
    expect(screen.getByText("erro: sem ultralytics")).toBeInTheDocument();
  });

  it("selects model 2: no preview, inactive, actions disabled until trained", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/vazio · novo/));
    expect(await screen.findByDisplayValue("vazio")).toBeInTheDocument();
    expect(screen.queryByTestId("cam-video")).toBeNull(); // câmera 99 não existe
    // sem treino → testar e ativar desabilitados; sem frames → treinar desabilitado
    expect(screen.getByRole("button", { name: "3. Ativar alerta" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2. Testar ao vivo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1. Treinar" })).toBeDisabled();
    expect(screen.getByText(/Capture frames das duas classes primeiro/)).toBeInTheDocument();
  });

  it("captures a frame", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    await user.click(await screen.findByRole("button", { name: /Capturar “aberto”/ }));
    await waitFor(() => expect(api.captureFrame).toHaveBeenCalledWith(1, "aberto"));
  });

  it("deletes a frame", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    await user.click((await screen.findAllByRole("button", { name: "✕" }))[0]);
    await waitFor(() => expect(api.deleteModelFrame).toHaveBeenCalledWith(1, "aberto", "f1.jpg"));
  });

  it("saves the crop", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    const x1 = await screen.findByLabelText("x1");
    await user.clear(x1);
    await user.type(x1, "10");
    await user.click(screen.getByRole("button", { name: "Salvar crop" }));
    await waitFor(() =>
      expect(api.setModelCrop).toHaveBeenCalledWith(1, { x1: 10, y1: 2, x2: 3, y2: 4 }),
    );
  });

  it("trains the model", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    await user.click(await screen.findByRole("button", { name: "1. Treinar" }));
    await waitFor(() => expect(api.trainModel).toHaveBeenCalledWith(1));
  });

  it("tests the model live and shows label + confidence", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    await user.click(await screen.findByRole("button", { name: "2. Testar ao vivo" }));
    expect(await screen.findByText(/aberto \(87%\)/)).toBeInTheDocument();
  });

  it("shows a fallback when the test result is empty", async () => {
    api.testModel.mockResolvedValue({ label: null, confidence: null });
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    await user.click(await screen.findByRole("button", { name: "2. Testar ao vivo" }));
    expect(await screen.findByText(/resultado: \?/)).toBeInTheDocument();
  });

  it("toggles the alert active state", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByText(/portao · pronto/));
    await user.click(await screen.findByRole("button", { name: "Desativar alerta" }));
    await waitFor(() => expect(api.activateModel).toHaveBeenCalledWith(1, false));
  });

  it("auto-refreshes while a model is training (polling)", async () => {
    vi.useFakeTimers();
    try {
      const treinando = { ...M1, status: "treinando" };
      api.listModels.mockResolvedValue([treinando]);
      const { container } = render(<Training />);
      await act(async () => {}); // flush load inicial
      const chip = container.querySelector(".model-chip") as HTMLElement;
      await act(async () => {
        chip.click();
      });
      await act(async () => {}); // flush loadFrames
      expect(screen.getByText(/treinando…/)).toBeInTheDocument();
      const before = api.listModels.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(3000); // dispara o interval → refresh
      });
      expect(api.listModels.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates back to the cameras grid", async () => {
    const user = userEvent.setup();
    render(<Training />);
    await user.click(await screen.findByRole("button", { name: "← Câmeras" }));
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
