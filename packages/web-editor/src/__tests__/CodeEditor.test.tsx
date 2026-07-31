/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
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
  onOpenLatexImport: vi.fn(),
  onOpenDocinfoEditor: vi.fn(),
  onShowFullSource: vi.fn(),
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
});
