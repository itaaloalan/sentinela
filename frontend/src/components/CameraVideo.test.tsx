import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    media: string;
    visibilityThreshold: number;
  };
}

describe("CameraVideo", () => {
  it("connects the video-stream to the proxied go2rtc WebSocket, always muted", () => {
    const { container } = render(<CameraVideo name="portao" />);
    const el = getStream(container);
    expect(el.src).toBe("ws://localhost/go2rtc/api/ws?src=portao");
    expect(el.mode).toBe("webrtc,mse");
    expect(el.media).toBe("video"); // sem áudio — não há controle de som na UI
    expect(el.visibilityThreshold).toBe(0.05); // desconecta fora da viewport
  });

  it("shows a connecting placeholder until the stream paints", () => {
    render(<CameraVideo name="portao" />);
    expect(screen.getByText(/conectando/)).toBeInTheDocument();
  });

  it("notifies and configures the inner video (mute/playsInline/no native controls) when it starts playing", () => {
    const onPlaying = vi.fn();
    const { container } = render(
      <CameraVideo name="portao" onPlaying={onPlaying} />,
    );
    const video = document.createElement("video");
    container.querySelector("video-stream")!.appendChild(video);
    fireEvent(video, new Event("playing")); // captura no wrapper pega o evento
    expect(onPlaying).toHaveBeenCalledOnce();
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(false);
  });

  it("does not blow up without an onPlaying callback", () => {
    const { container } = render(<CameraVideo name="portao" />);
    const video = document.createElement("video");
    container.querySelector("video-stream")!.appendChild(video);
    expect(() => fireEvent(video, new Event("playing"))).not.toThrow();
  });

  it("notifies on every rendered frame via timeupdate", () => {
    const onFrame = vi.fn();
    const { container } = render(<CameraVideo name="portao" onFrame={onFrame} />);
    const video = document.createElement("video");
    container.querySelector("video-stream")!.appendChild(video);
    fireEvent(video, new Event("timeupdate"));
    fireEvent(video, new Event("timeupdate"));
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it("does not blow up without an onFrame callback", () => {
    const { container } = render(<CameraVideo name="portao" />);
    const video = document.createElement("video");
    container.querySelector("video-stream")!.appendChild(video);
    expect(() => fireEvent(video, new Event("timeupdate"))).not.toThrow();
  });

  it("enters fullscreen on double click when not in fullscreen", () => {
    const req = vi.fn();
    HTMLElement.prototype.requestFullscreen = req;
    const { container } = render(<CameraVideo name="portao" />);
    fireEvent.doubleClick(container.querySelector(".cam-video-wrap")!);
    expect(req).toHaveBeenCalledOnce();
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
  });

  it("exits fullscreen on double click when already in fullscreen", () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    const exit = vi.fn();
    (document as unknown as { exitFullscreen: () => void }).exitFullscreen = exit;
    const { container } = render(<CameraVideo name="portao" />);
    fireEvent.doubleClick(container.querySelector(".cam-video-wrap")!);
    expect(exit).toHaveBeenCalledOnce();
  });
});
