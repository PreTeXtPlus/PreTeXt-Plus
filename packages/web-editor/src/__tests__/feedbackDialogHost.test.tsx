/**
 * The feedback dialog is opened from the top bar's Help menu, but its overlay
 * is `absolute inset-0`: rendered where it is opened, it would cover only the
 * top bar. It portals into the editor's root instead, so it covers the editor.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Editors from "../components/Editors";
import { legacyDivisions } from "./legacyDivision";

vi.mock("../components/CodeEditor", () => ({
  __esModule: true,
  default: (props: { content: string }) => (
    <textarea data-testid="code-editor" value={props.content} readOnly />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const divisions = legacyDivisions([
  {
    id: "1",
    xmlId: "doc",
    title: "Main",
    type: "article",
    sourceFormat: "pretext",
    source: '<article xml:id="doc">\n<title>Main</title>\n<p>Hi.</p>\n</article>',
  },
]);

describe("the feedback dialog opened from the Help menu", () => {
  it("covers the whole editor, not just the top bar", async () => {
    const user = userEvent.setup();
    render(
      <Editors
        divisions={divisions}
        rootDivisionId="doc"
        projectType="article"
        title="Doc"
        onContentChange={() => {}}
        onFeedbackSubmit={() => {}}
        topBar={{
          helpMenu: (helpers) => ({
            label: "Help",
            entries: [
              {
                kind: "item",
                key: "feedback",
                label: "Support / Feedback",
                onSelect: helpers.onGiveFeedback,
              },
            ],
          }),
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: "Support / Feedback" }));

    const dialog = screen.getByRole("dialog", { name: "Send feedback or get help" });
    const overlay = dialog.parentElement!;
    const root = screen.getByRole("menubar", { name: "Editor actions" }).closest(
      ".relative.overflow-x-hidden",
    );
    // The overlay sits directly in the editor's root, beside the top bar —
    // not inside it.
    expect(overlay.parentElement).toBe(root);
  });
});
