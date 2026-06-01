import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CropEditor } from "./CropEditor";

// jsdom não calcula layout: simulamos a geometria do palco e o tamanho natural
// da imagem para validar a conversão "pixels exibidos → pixels do frame".
function mockGeometry(displayW = 480, displayH = 270, naturalW = 1920, naturalH = 1080) {
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, width: displayW, height: displayH, right: displayW, bottom: displayH, x: 0, y: 0, toJSON: () => {},
  } as DOMRect);
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, value: naturalW });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, value: naturalH });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CropEditor", () => {
  it("shows the saved crop and disables save until a selection is drawn", () => {
    const onSave = vi.fn();
    render(<CropEditor src="/snap.jpg" crop={{ x1: 10, y1: 20, x2: 30, y2: 40 }} onSave={onSave} />);
    expect(screen.getByText(/recorte salvo: \(10,20\) → \(30,40\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar recorte" })).toBeDisabled();
  });

  it("prompts to drag when there is no crop", () => {
    render(<CropEditor src="/snap.jpg" crop={null} onSave={vi.fn()} />);
    expect(screen.getByText(/Arraste sobre o portão/)).toBeInTheDocument();
  });

  it("converts a dragged rectangle to source pixels and saves", async () => {
    mockGeometry(480, 270, 1920, 1080); // escala 4x em ambos os eixos
    const onSave = vi.fn();
    const { container } = render(<CropEditor src="/snap.jpg" crop={null} onSave={onSave} />);
    const stage = container.querySelector(".crop-stage") as HTMLElement;
    fireEvent.pointerDown(stage, { clientX: 100, clientY: 50 });
    fireEvent.pointerMove(stage, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(stage);
    // hint muda para "ajustar" e o botão habilita
    expect(screen.getByText(/arraste de novo para ajustar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar recorte" }));
    // 100..300 ×4 = 400..1200 ; 50..200 ×4 = 200..800
    expect(onSave).toHaveBeenCalledWith({ x1: 400, y1: 200, x2: 1200, y2: 800 });
    // confirmação visível + retângulo de edição some
    expect(await screen.findByText(/✓ recorte salvo: \(400,200\) → \(1200,800\)/)).toBeInTheDocument();
  });

  it("normalizes a rectangle dragged up-and-left and clamps to bounds", async () => {
    mockGeometry(480, 270, 480, 270); // escala 1x
    const onSave = vi.fn();
    const { container } = render(<CropEditor src="/snap.jpg" crop={null} onSave={onSave} />);
    const stage = container.querySelector(".crop-stage") as HTMLElement;
    // começa embaixo/direita e arrasta pra fora (cima/esquerda) → normaliza + clampa em 0
    fireEvent.pointerDown(stage, { clientX: 200, clientY: 150 });
    fireEvent.pointerMove(stage, { clientX: -50, clientY: -50 });
    fireEvent.pointerUp(stage);
    fireEvent.click(screen.getByRole("button", { name: "Salvar recorte" }));
    expect(onSave).toHaveBeenCalledWith({ x1: 0, y1: 0, x2: 200, y2: 150 });
    await screen.findByText(/✓ recorte salvo/); // aguarda o estado assíncrono assentar
  });

  it('"Ver recorte" overlays the saved crop after the image loads', async () => {
    const user = userEvent.setup();
    render(<CropEditor src="/snap.jpg" crop={{ x1: 480, y1: 0, x2: 960, y2: 540 }} onSave={vi.fn()} />);
    const img = screen.getByAltText("quadro da câmera");
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: 1920 });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: 1080 });

    // antes de carregar a imagem (sem nat), o overlay não aparece mesmo ligado
    await user.click(screen.getByRole("button", { name: "👁 Ver recorte" }));
    expect(screen.queryByTestId("saved-rect")).toBeNull();

    fireEvent.load(img); // agora temos as dimensões naturais
    const rect = await screen.findByTestId("saved-rect");
    expect(rect).toHaveStyle({ left: "25%", width: "25%", top: "0%", height: "50%" });

    // alterna de volta para ocultar
    await user.click(screen.getByRole("button", { name: "Ocultar recorte" }));
    expect(screen.queryByTestId("saved-rect")).toBeNull();
  });

  it("has no 'Ver recorte' button when there is no saved crop", () => {
    render(<CropEditor src="/snap.jpg" crop={null} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Ver recorte/ })).toBeNull();
  });

  it("ignores pointer move when no drag is in progress", () => {
    mockGeometry();
    render(<CropEditor src="/snap.jpg" crop={null} onSave={vi.fn()} />);
    const stage = document.querySelector(".crop-stage") as HTMLElement;
    fireEvent.pointerMove(stage, { clientX: 50, clientY: 50 }); // sem pointerDown antes
    expect(screen.getByRole("button", { name: "Salvar recorte" })).toBeDisabled();
  });

  it("does nothing on save when there is no selection", () => {
    const onSave = vi.fn();
    render(<CropEditor src="/snap.jpg" crop={{ x1: 1, y1: 1, x2: 2, y2: 2 }} onSave={onSave} />);
    // botão começa desabilitado sem seleção — chamar o handler diretamente é no-op
    expect(screen.getByRole("button", { name: "Salvar recorte" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
