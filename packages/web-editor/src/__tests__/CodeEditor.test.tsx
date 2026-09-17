/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CodeEditor from "../components/CodeEditor";

const monacoEditorMock = vi.fn((props: { options?: { readOnly?: boolean } }) => (
  <div data-testid="monaco-mock" data-readonly={String(!!props.options?.readOnly)} />
));

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: { options?: { readOnly?: boolean } }) => monacoEditorMock(props),
}));

const baseProps = {
  content: "<article/>",
  sourceFormat: "pretext" as const,
  onChange: vi.fn(),
};

describe("CodeEditor", () => {
  it("passes readOnly: true to Monaco when the readOnly prop is set", () => {
    render(<CodeEditor {...baseProps} readOnly />);
    const calls = monacoEditorMock.mock.calls;
    const call = calls[calls.length - 1]?.[0];
    expect(call?.options?.readOnly).toBe(true);
  });

  it("passes readOnly: false to Monaco by default", () => {
    render(<CodeEditor {...baseProps} />);
    const calls = monacoEditorMock.mock.calls;
    const call = calls[calls.length - 1]?.[0];
    expect(call?.options?.readOnly).toBe(false);
  });

  it("reports menu state via onMenuStateChange after mount", () => {
    const onMenuStateChange = vi.fn();
    render(<CodeEditor {...baseProps} onMenuStateChange={onMenuStateChange} />);
    expect(onMenuStateChange).toHaveBeenCalled();
    const state = onMenuStateChange.mock.calls[0][0];
    expect(state).toEqual(
      expect.objectContaining({
        canUndo: expect.any(Boolean),
        canRedo: expect.any(Boolean),
        hasSelection: expect.any(Boolean),
        isFindingInFile: expect.any(Boolean),
        onUndo: expect.any(Function),
        onRedo: expect.any(Function),
        switchToFindInProject: expect.any(Function),
        actions: expect.objectContaining({
          runCommand: expect.any(Function),
          cut: expect.any(Function),
          copy: expect.any(Function),
          paste: expect.any(Function),
          selectAll: expect.any(Function),
          insertSnippet: expect.any(Function),
        }),
      }),
    );
  });

  it.each([
    ["pretext", "PreTeXt"],
    ["latex", "LaTeX"],
    ["markdown", "Markdown"],
  ] as const)(
    "shows a floating %s format badge over the editor",
    (sourceFormat, label) => {
      render(<CodeEditor {...baseProps} sourceFormat={sourceFormat} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});
