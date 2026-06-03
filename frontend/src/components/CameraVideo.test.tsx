import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CameraVideo } from "./CameraVideo";

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: null,
  });
});

function getStream(container: HTMLElement) {
  return container.querySelector("video-stream") as unknown as {
    src: string;
    mode: string;
  };
}

describe("CameraVideo", () => {
  it("connects the video-stream to the proxied go2rtc WebSocket", () => {
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const el = getStream(container) as unknown as {
      src: string;
      mode: string;
      media: string;
      visibilityThreshold: number;
    };
    expect(el.src).toBe("ws://localhost/go2rtc/api/ws?src=portao");
    expect(el.mode).toBe("webrtc,mse");
    expect(el.media).toBe("video"); // mutado por padrão → sem áudio no stream
    expect(el.visibilityThreshold).toBe(0.05); // desconecta fora da viewport
  });

  it("shows a connecting placeholder until the stream paints", () => {
    render(<CameraVideo id={1} name="portao" />);
    expect(screen.getByText(/conectando/)).toBeInTheDocument();
  });

  it("toggles audio mute on the inner video", async () => {
    const user = userEvent.setup();
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const video = document.createElement("video");
    container.querySelector("video-stream")!.appendChild(video);
    await user.click(screen.getByRole("button", { name: "Ativar som" }));
    expect(video.muted).toBe(false);
    // toca sempre: playsinline ligado e sem controles nativos (play no mobile)
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(false);
    expect(screen.getByRole("button", { name: "Mutar" })).toBeInTheDocument();
  });

  it("downloads a snapshot via an anchor", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const user = userEvent.setup();
    render(<CameraVideo id={9} name="portao" />);
    await user.click(screen.getByRole("button", { name: "Tirar foto" }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("enters fullscreen when not in fullscreen", async () => {
    // jsdom não implementa a Fullscreen API → injetamos o mock
    const req = vi.fn();
    HTMLElement.prototype.requestFullscreen = req;
    const user = userEvent.setup();
    render(<CameraVideo id={1} name="portao" />);
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(req).toHaveBeenCalledOnce();
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
  });

  it("zooms in/out and pans with pointer drag", async () => {
    const user = userEvent.setup();
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const stream = container.querySelector("video-stream") as HTMLElement;

    // sem zoom, arrastar não move (drag.current fica null)
    fireEvent.pointerDown(stream, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(stream, { clientX: 50, clientY: 50 });
    expect(stream.style.transform).toContain("scale(1)");

    // aproxima
    await user.click(screen.getByRole("button", { name: "Aproximar" }));
    expect(stream.style.transform).toContain("scale(1.5)");

    // agora arrastar move (pan)
    fireEvent.pointerDown(stream, { clientX: 10, clientY: 20 });
    fireEvent.pointerMove(stream, { clientX: 40, clientY: 60 });
    fireEvent.pointerUp(stream);
    expect(stream.style.transform).toContain("translate(30px, 40px)");

    // afasta de volta ao 1 → zera o pan
    await user.click(screen.getByRole("button", { name: "Afastar" }));
    expect(stream.style.transform).toBe("scale(1) translate(0px, 0px)");
  });

  it("notifies when the stream actually starts playing", () => {
    const onPlaying = vi.fn();
    const { container } = render(
      <CameraVideo id={1} name="portao" onPlaying={onPlaying} />,
    );
    const video = document.createElement("video");
    container.querySelector("video-stream")!.appendChild(video);
    fireEvent(video, new Event("playing")); // captura no wrapper pega o evento
    expect(onPlaying).toHaveBeenCalledOnce();
  });

  it("toggles the controls with a simple tap (mobile)", () => {
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const stream = container.querySelector("video-stream") as HTMLElement;
    const wrap = container.querySelector(".cam-video-wrap") as HTMLElement;
    // toque com deslize mínimo (< 8px) ainda conta como toque
    fireEvent.pointerDown(stream, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(stream, { clientX: 12, clientY: 12 });
    fireEvent.pointerUp(stream);
    expect(wrap.className).toContain("controls-on");
    fireEvent.pointerDown(stream, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(stream);
    expect(wrap.className).not.toContain("controls-on");
  });

  it("does not toggle controls on a vertical scroll gesture", () => {
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const stream = container.querySelector("video-stream") as HTMLElement;
    const wrap = container.querySelector(".cam-video-wrap") as HTMLElement;
    fireEvent.pointerDown(stream, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(stream, { clientX: 12, clientY: 60 }); // rolagem vertical
    fireEvent.pointerUp(stream);
    expect(wrap.className).not.toContain("controls-on");
  });

  it("ignores stray pointer events without a touch start", () => {
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const stream = container.querySelector("video-stream") as HTMLElement;
    const wrap = container.querySelector(".cam-video-wrap") as HTMLElement;
    fireEvent.pointerMove(stream, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(stream);
    expect(wrap.className).not.toContain("controls-on");
  });

  it("marks the stream as zoomed so touch panning takes over scrolling", async () => {
    const user = userEvent.setup();
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const stream = container.querySelector("video-stream") as HTMLElement;
    expect(stream.className).not.toContain("zoomed");
    await user.click(screen.getByRole("button", { name: "Aproximar" }));
    expect(stream.className).toContain("zoomed");
    await user.click(screen.getByRole("button", { name: "Afastar" }));
    expect(stream.className).not.toContain("zoomed");
  });

  it("exits fullscreen when already in fullscreen", async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    const exit = vi.fn();
    (document as unknown as { exitFullscreen: () => void }).exitFullscreen = exit;
    const user = userEvent.setup();
    render(<CameraVideo id={1} name="portao" />);
    await user.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(exit).toHaveBeenCalledOnce();
  });

  it("toggles two-way audio (microphone) on/off", async () => {
    const user = userEvent.setup();
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const el = getStream(container) as unknown as { media: string; mode: string };
    expect(el.media).toBe("video"); // mutado → só vídeo
    await user.click(screen.getByRole("button", { name: "Falar" }));
    expect(el.media).toBe("video,audio,microphone");
    expect(el.mode).toBe("webrtc");
    await user.click(screen.getByRole("button", { name: "Parar de falar" }));
    expect(el.media).toBe("video");
  });

  it("requests audio in the stream only when unmuted", async () => {
    const user = userEvent.setup();
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const el = getStream(container) as unknown as { media: string };
    expect(el.media).toBe("video");
    await user.click(screen.getByRole("button", { name: "Ativar som" }));
    expect(el.media).toBe("video,audio");
    await user.click(screen.getByRole("button", { name: "Mutar" }));
    expect(el.media).toBe("video");
  });

  it("no PTZ pad when ptz is false", () => {
    render(<CameraVideo id={1} name="portao" />);
    expect(screen.queryByRole("button", { name: "Cima" })).toBeNull();
  });

  it("sends ONVIF PTZ on press and stop on release", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getByRole } = render(<CameraVideo id={5} name="portao" ptz />);
    const left = getByRole("button", { name: "Esquerda" });
    fireEvent.pointerDown(left);
    fireEvent.pointerUp(left);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cameras/5/ptz");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      pan: -0.5,
      tilt: 0,
      zoom: 0,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      pan: 0,
      tilt: 0,
      zoom: 0,
    });
    vi.unstubAllGlobals();
  });
});
