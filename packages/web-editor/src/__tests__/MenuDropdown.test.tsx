/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("MenuDropdown submenus", () => {
  const onSelect = vi.fn();
  const onNavigate = vi.fn();

  const withSubmenus: MenuEntry[] = [
    { kind: "item", key: "plain", label: "Plain", onSelect },
    {
      kind: "submenu",
      key: "more",
      label: "More",
      entries: [
        { kind: "item", key: "one", label: "One", onSelect },
        { kind: "item", key: "two", label: "Two", onSelect },
      ],
    },
    {
      kind: "submenu",
      key: "other",
      label: "Other",
      entries: [{ kind: "item", key: "three", label: "Three", onSelect }],
    },
  ];

  const SubmenuHarness = () => {
    const [open, setOpen] = useState(false);
    return (
      <MenuDropdown
        label="Insert"
        entries={withSubmenus}
        isOpen={open}
        onOpenChange={setOpen}
        onNavigate={onNavigate}
      />
    );
  };

  const item = (name: string) => screen.getByRole("menuitem", { name });
  const submenu = (name: string) => screen.queryByRole("menu", { name });

  /** Render the harness and open its menu; focus lands on "Plain". */
  async function openInsert() {
    onSelect.mockClear();
    onNavigate.mockClear();
    const user = userEvent.setup();
    render(<SubmenuHarness />);
    await user.click(screen.getByRole("button", { name: "Insert" }));
    return user;
  }

  it("opens a submenu from its row and runs its items", async () => {
    const user = await openInsert();
    expect(item("More")).toHaveAttribute("aria-haspopup", "menu");
    expect(item("More")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menuitem", { name: "One" })).not.toBeInTheDocument();

    await user.click(item("More"));
    expect(item("More")).toHaveAttribute("aria-expanded", "true");
    expect(submenu("More")).toBeInTheDocument();

    await user.click(item("One"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Choosing an item closes the whole menu, not just the submenu.
    expect(submenu("Insert")).not.toBeInTheDocument();
  });

  it("keeps one submenu open at a time", async () => {
    const user = await openInsert();
    await user.click(item("More"));
    await user.click(item("Other"));

    expect(submenu("More")).not.toBeInTheDocument();
    expect(submenu("Other")).toBeInTheDocument();
  });

  it("enters a submenu with Arrow Right and leaves it with Arrow Left", async () => {
    const user = await openInsert();
    await user.keyboard("{ArrowDown}");
    expect(item("More")).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(item("One")).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();

    // Up/Down stay inside the submenu, wrapping at its ends.
    await user.keyboard("{ArrowDown}");
    expect(item("Two")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("One")).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(submenu("More")).not.toBeInTheDocument();
    expect(item("More")).toHaveFocus();
  });

  it("enters a submenu with Enter rather than toggling it", async () => {
    const user = await openInsert();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(item("One")).toHaveFocus();
  });

  it("walks the top level past an open submenu's items", async () => {
    const user = await openInsert();
    await user.click(item("More"));
    expect(item("More")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(item("Other")).toHaveFocus();
  });

  it("closes only the submenu on Escape, then the menu on a second", async () => {
    const user = await openInsert();
    await user.keyboard("{ArrowDown}{ArrowRight}{Escape}");

    expect(submenu("More")).not.toBeInTheDocument();
    expect(submenu("Insert")).toBeInTheDocument();
    expect(item("More")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(submenu("Insert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert" })).toHaveFocus();
  });

  it("crosses to the next menu with Arrow Right from an ordinary item", async () => {
    const user = await openInsert();
    await user.keyboard("{ArrowRight}");
    expect(onNavigate).toHaveBeenLastCalledWith(1);

    // An item inside a submenu is ordinary too.
    await user.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}");
    expect(item("One")).toHaveFocus();
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("follows the pointer: resting on a row opens its submenu, and the click after doesn't shut it", async () => {
    const user = await openInsert();
    await user.hover(item("More"));
    await waitFor(() => expect(submenu("More")).toBeInTheDocument());

    await user.click(item("More"));
    expect(submenu("More")).toBeInTheDocument();

    await user.hover(item("Plain"));
    await waitFor(() => expect(submenu("More")).not.toBeInTheDocument());
  });

  it("lets the menu itself scroll only when it has no flyouts to clip", async () => {
    const user = await openInsert();
    expect(submenu("Insert")).not.toHaveClass("overflow-y-auto");
    await user.click(item("More"));
    expect(submenu("More")).toHaveClass("sm:overflow-y-auto");
  });
});
