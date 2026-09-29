/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import MenuDropdown, { type MenuEntry } from "../components/MenuDropdown";

const entries: MenuEntry[] = [
  { kind: "item", key: "settings", label: "Settings", onSelect: vi.fn() },
];

/** A MenuDropdown owning its own open state, as a one-menu menubar would. */
const Harness = () => {
  const [open, setOpen] = useState(false);
  return (
    <MenuDropdown
      label="Account"
      entries={entries}
      isOpen={open}
      onOpenChange={setOpen}
      align="right"
      icon={<svg data-testid="menu-icon" />}
      iconOnlyWhenCompact
      outlined
    />
  );
};

describe("MenuDropdown", () => {
  it("shows an icon and keeps the label as the button's accessible name", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId("menu-icon")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Account" });
    expect(screen.getByText("Account")).toHaveClass("max-[52rem]:sr-only");
    expect(button).toHaveClass("rounded-md", "border-gray-300");

    await user.click(button);
    expect(
      screen.getByRole("menuitem", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("renders the bare label when no icon is given", () => {
    render(
      <MenuDropdown
        label="File"
        entries={entries}
        isOpen={false}
        onOpenChange={() => {}}
        iconOnlyWhenCompact
      />,
    );
    expect(screen.getByRole("button", { name: "File" })).toHaveTextContent(
      "File",
    );
    expect(screen.getByText("File").tagName).toBe("BUTTON");
  });
});
