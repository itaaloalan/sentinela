import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    const el = getStream(container);
    expect(el.src).toBe("ws://localhost/go2rtc/api/ws?src=portao");
    expect(el.mode).toBe("webrtc,mse");
  });

  it("toggles audio mute on the inner video", async () => {
    const user = userEvent.setup();
    const { container } = render(<CameraVideo id={1} name="portao" />);
    const video = document.createElement("video");
    container.querySelector("video-stream")!.appendChild(video);
    await user.click(screen.getByRole("button", { name: "Ativar som" }));
    expect(video.muted).toBe(false);
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
});
