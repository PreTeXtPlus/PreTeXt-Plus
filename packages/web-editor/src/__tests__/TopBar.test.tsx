/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import TopBar, { type TopBarProps } from "../components/TopBar";
import { createEditorStore } from "../store/editorStore";
import { EditorStoreProvider } from "../store/EditorStoreProvider";

function renderWithStore(props: Partial<TopBarProps> = {}) {
  const { store, bindCallbacks } = createEditorStore({
    source: "",
    sourceFormat: "pretext",
    title: "My Document",
    docinfo: "",
    commonDocinfo: "",
    useCommonDocinfo: false,
    language: "en-US",
    divisions: [],
    activeDivisionId: null,
    projectAssets: undefined,
  });
  const noop = () => {};
  bindCallbacks({
    selectDivision: noop,
    addDivision: noop,
    createDivision: noop,
    removeDivision: noop,
    updateDivision: noop,
    divisionContentChange: noop,
    handleDivisionContentChange: noop,
    assetInsert: noop,
    snippetInsert: noop,
    updateTitle: (title) => store.getState().setTitle(title),
    updateLanguage: (language) => store.getState().setLanguage(language),
    feedbackSubmit: noop,
  });
  store.getState().syncState({ hasFeedback: true });

  const baseProps: TopBarProps = {
    content: "<article/>",
    sourceFormat: "pretext",
    onContentChange: vi.fn(),
    onOpenImport: vi.fn(),
    onOpenDocinfoEditor: vi.fn(),
    onShowFullSource: vi.fn(),
    menuState: null,
    ...props,
  };

  const wrap = (children: ReactNode) => (
    <EditorStoreProvider store={store}>{children}</EditorStoreProvider>
  );
  return render(wrap(<TopBar {...baseProps} />));
}

describe("TopBar", () => {
  it("renders the supplied logo and account area, falling back to a placeholder logo", () => {
    renderWithStore({
      logo: <span>My Host Logo</span>,
      accountArea: <span>Account stuff</span>,
    });
    expect(screen.getByText("My Host Logo")).toBeInTheDocument();
    expect(screen.getByText("Account stuff")).toBeInTheDocument();
  });

  it("renders a helpMenu inline with File/Edit/Insert/Tools/Language, wired to the feedback dialog", async () => {
    const user = userEvent.setup();
    renderWithStore({
      helpMenu: (helpers) => ({
        label: "Help & Feedback",
        entries: [
          {
            kind: "item",
            key: "feedback",
            label: "Support / Feedback",
            onSelect: helpers.onGiveFeedback,
          },
        ],
      }),
    });
    const names = screen
      .getByRole("menubar", { name: "Editor actions" })
      .querySelectorAll("button");
    const labels = Array.from(names).map((b) => b.textContent);
    expect(labels).toEqual([
      "File",
      "Edit",
      "Insert",
      "Tools",
      "Language",
      "Help & Feedback",
    ]);

    expect(
      screen.queryByText("Provide Feedback or Request Support"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Help & Feedback" }));
    await user.click(screen.getByRole("menuitem", { name: "Support / Feedback" }));
    expect(
      screen.getByText("Provide Feedback or Request Support"),
    ).toBeInTheDocument();
  });

  it("omits the Help menu when helpMenu is not provided", () => {
    renderWithStore();
    expect(
      screen.queryByRole("button", { name: /Help/ }),
    ).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when no logo is supplied", () => {
    renderWithStore();
    expect(screen.getByText("✏️")).toBeInTheDocument();
  });

  it("shows the title and a Language menu", () => {
    renderWithStore();
    expect(screen.getByText("My Document")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
  });

  it("picks a language from the Language menu", async () => {
    const user = userEvent.setup();
    renderWithStore();
    await user.click(screen.getByRole("button", { name: "Language" }));
    const current = screen.getByRole("menuitemcheckbox", {
      name: "English (United States)",
    });
    expect(current).toHaveAttribute("aria-checked", "true");
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "German (Germany)" }),
    );
    await user.click(screen.getByRole("button", { name: "Language" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "German (Germany)" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("disables the Language menu when readOnly", () => {
    renderWithStore({ readOnly: true });
    expect(screen.getByRole("button", { name: "Language" })).toBeDisabled();
  });

  it("places Language on the lower menu row, to the right of Tools", () => {
    renderWithStore();
    const names = screen
      .getByRole("menubar", { name: "Editor actions" })
      .querySelectorAll("button");
    const labels = Array.from(names).map((b) => b.textContent);
    expect(labels).toEqual(["File", "Edit", "Insert", "Tools", "Language"]);
  });

  it("shows a static titleOverride instead of the editable title", () => {
    renderWithStore({ titleOverride: "Try PreTeXt in Your Browser!" });
    expect(
      screen.getByText("Try PreTeXt in Your Browser!"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "edit" })).not.toBeInTheDocument();
  });

  it("offers File, Edit, Insert, and Tools menus", () => {
    renderWithStore();
    for (const name of ["File", "Edit", "Insert", "Tools"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("shows Save & Close in File only when onSaveAndClose is provided, and never a Cancel row", async () => {
    const onSaveAndClose = vi.fn();
    const user = userEvent.setup();
    renderWithStore({ onSaveAndClose });
    await user.click(screen.getByRole("button", { name: "File" }));
    const saveItem = screen.getByRole("menuitem", { name: "Save & Close" });
    expect(saveItem).toBeInTheDocument();
    await user.click(saveItem);
    expect(onSaveAndClose).toHaveBeenCalled();
    expect(
      screen.queryByRole("menuitem", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("omits Save & Close from File when onSaveAndClose is not provided", async () => {
    const user = userEvent.setup();
    renderWithStore();
    await user.click(screen.getByRole("button", { name: "File" }));
    expect(
      screen.queryByRole("menuitem", { name: "Save & Close" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Display Full Source" }),
    ).toBeInTheDocument();
  });

  it("keeps document actions out of Tools (they live in File instead)", async () => {
    const user = userEvent.setup();
    renderWithStore();
    await user.click(screen.getByRole("button", { name: "Tools" }));
    expect(
      screen.queryByRole("menuitem", { name: "Display Full Source" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^Command Palette/ }),
    ).toBeInTheDocument();
  });

  it("hides Insert when readOnly", () => {
    renderWithStore({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Insert" })).not.toBeInTheDocument();
  });

  it("renders Edit/Insert/Tools inertly before CodeEditor's first menuState report", async () => {
    const user = userEvent.setup();
    renderWithStore({ menuState: null });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    // Should not throw when an action is invoked with no live Monaco instance.
    await user.click(screen.getByRole("menuitem", { name: /^Select All/ }));
  });

  it("shows no save status unless the host reports one", () => {
    renderWithStore();
    expect(screen.queryByTestId("save-status")).not.toBeInTheDocument();
  });

  it("shows the save status beside the title as an icon, not a button while nothing needs saving", () => {
    const onSaveNow = vi.fn();
    const { unmount } = renderWithStore({ saveStatus: "saved", onSaveNow });
    expect(screen.getByRole("img", { name: "Saved" })).toHaveAttribute(
      "title",
      "All changes saved",
    );
    expect(screen.queryByRole("button", { name: /Saved/ })).not.toBeInTheDocument();
    unmount();

    renderWithStore({ saveStatus: "saving", onSaveNow });
    expect(screen.getByRole("img", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Saving/ })).not.toBeInTheDocument();
  });

  it("offers to save now while there are unsaved changes or a failed save", async () => {
    const user = userEvent.setup();
    const onSaveNow = vi.fn();
    const { unmount } = renderWithStore({ saveStatus: "unsaved", onSaveNow });
    const unsaved = screen.getByRole("button", { name: "Unsaved changes" });
    expect(unsaved).toHaveAttribute("title", "Unsaved changes — click to save now");
    await user.click(unsaved);
    expect(onSaveNow).toHaveBeenCalledTimes(1);
    unmount();

    renderWithStore({ saveStatus: "error", onSaveNow });
    await user.click(screen.getByRole("button", { name: "Not saved" }));
    expect(onSaveNow).toHaveBeenCalledTimes(2);
  });

  it("renders the primary action as a labeled button", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithStore({
      primaryAction: {
        label: "Manage project",
        title: "Open the project page",
        icon: <svg data-testid="action-icon" />,
        onSelect,
      },
    });
    const button = screen.getByRole("button", { name: "Manage project" });
    expect(button).toHaveAttribute("title", "Open the project page");
    expect(screen.getByTestId("action-icon")).toBeInTheDocument();
    await user.click(button);
    expect(onSelect).toHaveBeenCalled();
  });

  it("renders no primary action button when none is supplied", () => {
    renderWithStore();
    expect(
      screen.queryByRole("button", { name: "Manage project" }),
    ).not.toBeInTheDocument();
  });

  describe("compact viewport", () => {
    /** Stubs `window.matchMedia` to report a fixed `matches` for every query. */
    function stubMatchMedia(matches: boolean) {
      const mql = {
        matches,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList;
      vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const accountMenuEntries = [
      {
        kind: "item" as const,
        key: "sign-out",
        label: "Sign out",
        onSelect: vi.fn(),
      },
    ];

    it("folds account entries into File and hides accountArea when compact", async () => {
      stubMatchMedia(true);
      const user = userEvent.setup();
      renderWithStore({
        accountArea: <span>Account stuff</span>,
        accountMenuEntries,
      });

      expect(screen.queryByText("Account stuff")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "File" }));
      expect(
        screen.getByRole("menuitem", { name: "Sign out" }),
      ).toBeInTheDocument();
    });

    it("keeps accountArea and leaves File unchanged without a matchMedia stub", async () => {
      const user = userEvent.setup();
      renderWithStore({
        accountArea: <span>Account stuff</span>,
        accountMenuEntries,
      });

      expect(screen.getByText("Account stuff")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "File" }));
      expect(
        screen.queryByRole("menuitem", { name: "Sign out" }),
      ).not.toBeInTheDocument();
    });
  });
});
