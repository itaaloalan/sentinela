import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AsyncButton } from "./AsyncButton";

describe("AsyncButton", () => {
  it("blocks and shows … while running, then re-enables", async () => {
    let resolve!: () => void;
    const onClick = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<AsyncButton onClick={onClick}>Salvar</AsyncButton>);
    const btn = screen.getByRole("button");
    await user.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("…");
    resolve();
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(btn).toHaveTextContent("Salvar");
  });

  it("respects the disabled prop and applies className/label", () => {
    render(
      <AsyncButton onClick={async () => {}} disabled className="ghost" label="Foo">
        X
      </AsyncButton>,
    );
    const btn = screen.getByRole("button", { name: "Foo" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveClass("ghost");
  });
});
