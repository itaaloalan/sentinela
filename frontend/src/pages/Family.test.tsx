import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Family from "./Family";

const api = {
  listUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  listViews: vi.fn(),
  sendEmergency: vi.fn(),
  isAdmin: true,
};
const nav = vi.fn();
vi.mock("../lib/api", () => ({
  auth: {
    get isAdmin() {
      return api.isAdmin;
    },
  },
  listUsers: (...a: unknown[]) => api.listUsers(...a),
  createUser: (...a: unknown[]) => api.createUser(...a),
  deleteUser: (...a: unknown[]) => api.deleteUser(...a),
  listViews: (...a: unknown[]) => api.listViews(...a),
  sendEmergency: (...a: unknown[]) => api.sendEmergency(...a),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => nav };
});

beforeEach(() => {
  api.isAdmin = true;
  api.listUsers.mockReset().mockResolvedValue([
    { id: 1, username: "admin", role: "admin" },
    { id: 2, username: "maria", role: "familiar" },
  ]);
  api.createUser.mockReset().mockResolvedValue({ id: 3, username: "joao", role: "familiar" });
  api.deleteUser.mockReset().mockResolvedValue(undefined);
  api.listViews.mockReset().mockResolvedValue([
    { id: 1, username: "maria", camera_id: 2, created_at: "2026-06-01T22:13:00+00:00" },
    { id: 2, username: "admin", camera_id: null, created_at: "2026-06-01T22:10:00+00:00" },
  ]);
  api.sendEmergency.mockReset().mockResolvedValue({ sent: true });
  nav.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Family />
    </MemoryRouter>,
  );
}

describe("Family", () => {
  it("lists users and the view history for an admin", async () => {
    renderPage();
    expect(await screen.findByText(/👑 admin/)).toBeInTheDocument();
    expect(screen.getByText(/👤 maria/)).toBeInTheDocument();
    expect(screen.getByText(/👁 maria/)).toBeInTheDocument();
    expect(screen.getByText(/painel/)).toBeInTheDocument();
  });

  it("fires the emergency after confirming", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "🆘 Emergência" }));
    await user.click(screen.getByRole("button", { name: "Enviar agora" }));
    expect(await screen.findByText(/Alerta de emergência enviado/)).toBeInTheDocument();
    expect(api.sendEmergency).toHaveBeenCalled();
  });

  it("can cancel the emergency arming", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "🆘 Emergência" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Enviar agora" })).not.toBeInTheDocument();
    expect(api.sendEmergency).not.toHaveBeenCalled();
  });

  it("shows an error when the emergency fails", async () => {
    api.sendEmergency.mockRejectedValue(new Error("ntfy fora"));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "🆘 Emergência" }));
    await user.click(screen.getByRole("button", { name: "Enviar agora" }));
    expect(await screen.findByText("ntfy fora")).toBeInTheDocument();
  });

  it("shows a generic emergency error for a non-Error rejection", async () => {
    api.sendEmergency.mockRejectedValue("x");
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "🆘 Emergência" }));
    await user.click(screen.getByRole("button", { name: "Enviar agora" }));
    expect(await screen.findByText("Falha ao enviar")).toBeInTheDocument();
  });

  it("creates a user", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/👑 admin/);
    await user.type(screen.getByPlaceholderText("usuário"), "joao");
    await user.type(screen.getByPlaceholderText("senha"), "segredo");
    await user.selectOptions(screen.getByLabelText("papel"), "familiar");
    await user.click(screen.getByRole("button", { name: "Adicionar pessoa" }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith("joao", "segredo", "familiar"));
  });

  it("shows an error when creating a user fails", async () => {
    api.createUser.mockRejectedValue(new Error("já existe"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/👑 admin/);
    await user.type(screen.getByPlaceholderText("usuário"), "x");
    await user.type(screen.getByPlaceholderText("senha"), "y");
    await user.click(screen.getByRole("button", { name: "Adicionar pessoa" }));
    expect(await screen.findByText("já existe")).toBeInTheDocument();
  });

  it("shows a generic error when creating rejects with a non-Error", async () => {
    api.createUser.mockRejectedValue("x");
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/👑 admin/);
    await user.type(screen.getByPlaceholderText("usuário"), "x");
    await user.type(screen.getByPlaceholderText("senha"), "y");
    await user.click(screen.getByRole("button", { name: "Adicionar pessoa" }));
    expect(await screen.findByText("Erro ao criar usuário")).toBeInTheDocument();
  });

  it("deletes a user", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/👤 maria/);
    await user.click(screen.getAllByRole("button", { name: "Excluir" })[1]);
    await waitFor(() => expect(api.deleteUser).toHaveBeenCalledWith(2));
  });

  it("shows an error when deleting fails", async () => {
    api.deleteUser.mockRejectedValue(new Error("nao deu"));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/👤 maria/);
    await user.click(screen.getAllByRole("button", { name: "Excluir" })[0]);
    expect(await screen.findByText("nao deu")).toBeInTheDocument();
  });

  it("shows a generic error when deleting rejects with a non-Error", async () => {
    api.deleteUser.mockRejectedValue("x");
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/👤 maria/);
    await user.click(screen.getAllByRole("button", { name: "Excluir" })[0]);
    expect(await screen.findByText("Erro ao excluir")).toBeInTheDocument();
  });

  it("shows an error when listing users fails", async () => {
    api.listUsers.mockRejectedValue(new Error("falha lista"));
    renderPage();
    expect(await screen.findByText("falha lista")).toBeInTheDocument();
  });

  it("shows a generic error when listing users rejects with a non-Error", async () => {
    api.listUsers.mockRejectedValue("x");
    renderPage();
    expect(await screen.findByText("Erro")).toBeInTheDocument();
  });

  it("hides management for non-admins but still allows emergency", async () => {
    api.isAdmin = false;
    renderPage();
    expect(screen.getByRole("button", { name: "🆘 Emergência" })).toBeInTheDocument();
    expect(screen.getByText(/exclusivos do administrador/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("usuário")).not.toBeInTheDocument();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  it("navigates back home", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "← Voltar" }));
    expect(nav).toHaveBeenCalledWith("/");
  });

  it("shows the empty state when there is no view history", async () => {
    api.listViews.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Nenhum acesso registrado ainda/)).toBeInTheDocument();
  });
});
