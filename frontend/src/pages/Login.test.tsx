import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "./Login";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

const loginFn = vi.fn();
vi.mock("../lib/api", () => ({ login: (...a: unknown[]) => loginFn(...a) }));

beforeEach(() => {
  navigate.mockReset();
  loginFn.mockReset();
});

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("usuário"), "admin");
  await user.type(screen.getByPlaceholderText("senha"), "secret");
  await user.click(screen.getByRole("button"));
}

describe("Login", () => {
  it("logs in and navigates home on success", async () => {
    loginFn.mockResolvedValue(undefined);
    render(<Login />);
    await fillAndSubmit();
    expect(loginFn).toHaveBeenCalledWith("admin", "secret");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("shows the error message when login fails with an Error", async () => {
    loginFn.mockRejectedValue(new Error("Credenciais inválidas"));
    render(<Login />);
    await fillAndSubmit();
    expect(await screen.findByText("Credenciais inválidas")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a generic message when login rejects with a non-Error", async () => {
    loginFn.mockRejectedValue("weird");
    render(<Login />);
    await fillAndSubmit();
    expect(await screen.findByText("Falha no login")).toBeInTheDocument();
  });

  it("disables the button and shows progress while busy", async () => {
    let resolve!: () => void;
    loginFn.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    render(<Login />);
    await fillAndSubmit();
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Entrando…");
    resolve();
  });
});
