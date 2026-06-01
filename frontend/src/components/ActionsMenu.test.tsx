import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionsMenu } from "./ActionsMenu";

describe("ActionsMenu", () => {
  it("opens and closes the drawer with the ☰ button", async () => {
    const user = userEvent.setup();
    render(
      <ActionsMenu>
        <button>Treinos</button>
      </ActionsMenu>,
    );
    const toggle = screen.getByRole("button", { name: "Menu de ações" });
    expect(screen.queryByText("Treinos")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText("Treinos")).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText("Treinos")).not.toBeInTheDocument();
  });

  it("closes when a menu item is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ActionsMenu>
        <button>Treinos</button>
      </ActionsMenu>,
    );
    await user.click(screen.getByRole("button", { name: "Menu de ações" }));
    await user.click(screen.getByText("Treinos"));
    expect(screen.queryByText("Treinos")).not.toBeInTheDocument();
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ActionsMenu>
        <button>Treinos</button>
      </ActionsMenu>,
    );
    await user.click(screen.getByRole("button", { name: "Menu de ações" }));
    await user.click(container.querySelector(".menu-backdrop") as HTMLElement);
    expect(screen.queryByText("Treinos")).not.toBeInTheDocument();
  });
});
