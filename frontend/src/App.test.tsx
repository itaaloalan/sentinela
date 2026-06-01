import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

const state = vi.hoisted(() => ({ loggedIn: false }));

vi.mock("./lib/api", () => ({
  auth: {
    get isLoggedIn() {
      return state.loggedIn;
    },
    logout: vi.fn(),
  },
  login: vi.fn(),
  listCameras: vi.fn().mockResolvedValue([]),
  createCamera: vi.fn(),
  deleteCamera: vi.fn(),
  snapshotUrl: (id: number) => `/api/cameras/${id}/snapshot`,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.loggedIn = false;
});

describe("App routing", () => {
  it("redirects to /login when logged out", () => {
    renderAt("/");
    expect(screen.getByPlaceholderText("usuário")).toBeInTheDocument();
  });

  it("renders the grid when logged in", async () => {
    state.loggedIn = true;
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("redirects unknown routes home", async () => {
    state.loggedIn = true;
    renderAt("/rota-inexistente");
    expect(await screen.findByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
