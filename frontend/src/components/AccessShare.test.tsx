import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessShare } from "./AccessShare";

const api = { getAccessInfo: vi.fn() };
vi.mock("../lib/api", () => ({
  getAccessInfo: (...a: unknown[]) => api.getAccessInfo(...a),
}));

const FULL = {
  username: "admin",
  password: "secret",
  local_url: "http://localhost:5173",
  tailscale_url: "http://100.64.0.5:5173",
  public_url: "http://203.0.113.7:5173",
};

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  api.getAccessInfo.mockReset().mockResolvedValue(FULL);
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("AccessShare", () => {
  it("opens the panel and shows credentials + all reachable URLs", async () => {
    const user = userEvent.setup();
    render(<AccessShare />);
    await user.click(screen.getByRole("button", { name: "🔗 Acesso" }));
    expect(await screen.findByText("admin")).toBeInTheDocument();
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.getByText("http://100.64.0.5:5173")).toBeInTheDocument();
    expect(screen.getByText("http://203.0.113.7:5173")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:5173")).toBeInTheDocument();
  });

  it("toggles the panel closed on a second click", async () => {
    const user = userEvent.setup();
    render(<AccessShare />);
    const btn = screen.getByRole("button", { name: "🔗 Acesso" });
    await user.click(btn);
    expect(await screen.findByText("admin")).toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });

  it("copies the address with username and password", async () => {
    const user = userEvent.setup();
    // userEvent.setup() instala seu próprio clipboard; reinstala o nosso spy.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<AccessShare />);
    await user.click(screen.getByRole("button", { name: "🔗 Acesso" }));
    await screen.findByText("admin");
    const [firstCopy] = screen.getAllByRole("button", { name: "Copiar" });
    await user.click(firstCopy);
    expect(writeText).toHaveBeenCalledWith(
      "Sentinela\nEndereço: http://100.64.0.5:5173\nUsuário: admin\nSenha: secret",
    );
    expect(await screen.findByText("✓ copiado")).toBeInTheDocument();
  });

  it("shows only the local URL when tailscale and public are absent", async () => {
    api.getAccessInfo.mockResolvedValue({
      ...FULL,
      tailscale_url: null,
      public_url: null,
    });
    const user = userEvent.setup();
    render(<AccessShare />);
    await user.click(screen.getByRole("button", { name: "🔗 Acesso" }));
    await screen.findByText("admin");
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.queryByText("Tailscale")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Copiar" })).toHaveLength(1);
  });

  it("shows the error message when the fetch fails (Error)", async () => {
    api.getAccessInfo.mockRejectedValue(new Error("backend fora"));
    const user = userEvent.setup();
    render(<AccessShare />);
    await user.click(screen.getByRole("button", { name: "🔗 Acesso" }));
    expect(await screen.findByText("backend fora")).toBeInTheDocument();
  });

  it("shows a generic error when the rejection is not an Error", async () => {
    api.getAccessInfo.mockRejectedValue("oops");
    const user = userEvent.setup();
    render(<AccessShare />);
    await user.click(screen.getByRole("button", { name: "🔗 Acesso" }));
    expect(await screen.findByText("Erro ao obter acesso")).toBeInTheDocument();
  });
});
