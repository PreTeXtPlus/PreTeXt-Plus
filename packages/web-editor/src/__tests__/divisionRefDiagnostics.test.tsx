/**
 * A division placeholder naming no division is flagged, not acted on: typing
 * one used to create the division on the spot, so editing a ref to point
 * somewhere else made one stray division per keystroke. The quick fix creates
 * it on request.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Editors from "../components/Editors";
import { findDivisionRefProblems, type DivisionRefCheckInput } from "../components/editorConfigs/divisionRefDiagnostics";
import { parseDivisionRefSpans } from "../sectionUtils";
import type { Division, DivisionType } from "../types/sections";

describe("findDivisionRefProblems", () => {
  const input: DivisionRefCheckInput = {
    sourceFormat: "pretext",
    divisionIds: new Set(["root", "intro"]),
    otherRefs: new Map([["fig", "an asset"]]),
  };

  it("flags a placeholder naming no division, at the placeholder", () => {
    const text = '<p/>\n<plus:section ref="intro"/>\n<plus:section ref="later"/>';
    const [problem] = findDivisionRefProblems(text, input);
    expect(problem).toMatchObject({ xmlId: "later", type: "section", canCreate: true, message: 'No division "later" exists.' });
    expect(text.slice(problem.index, problem.index + problem.length)).toBe('<plus:section ref="later"/>');
  });

  it("offers no create for a ref another record uses, or one that can't be an ID", () => {
    expect(findDivisionRefProblems('<plus:section ref="fig"/>', input)).toMatchObject([
      { canCreate: false, message: '"fig" is an asset, not a division.' },
    ]);
    expect(findDivisionRefProblems('<plus:section ref="9 lives"/>', input)).toMatchObject([{ canCreate: false }]);
  });

  it("checks each format's own syntax, and skips commented-out placeholders", () => {
    expect(findDivisionRefProblems("\\plus{worksheet}{w}", { ...input, sourceFormat: "latex" })).toMatchObject([
      { xmlId: "w", type: "worksheet" },
    ]);
    expect(findDivisionRefProblems('::chapter{ref="c"}', { ...input, sourceFormat: "markdown" })).toMatchObject([
      { xmlId: "c", type: "chapter" },
    ]);
    expect(findDivisionRefProblems('<!-- <plus:section ref="later"/> -->', input)).toEqual([]);
  });

  it("parseDivisionRefSpans locates every live placeholder", () => {
    expect(parseDivisionRefSpans('ab<plus:division ref="x"/>', "pretext")).toEqual([
      { xmlId: "x", type: "section", generic: true, index: 2, length: 24 },
    ]);
  });
});

// Monaco loads from a CDN; a textarea keeps the real `onChange` wiring, and a
// button stands in for choosing the quick fix.
vi.mock("../components/CodeEditor", () => ({
  __esModule: true,
  default: (props: {
    content: string;
    onChange: (value: string | undefined) => void;
    divisionRefCheck?: unknown;
    onCreateDivisionFromRef?: (xmlId: string, type: DivisionType) => void;
  }) => (
    <>
      <textarea
        data-testid="code-editor"
        value={props.content}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.divisionRefCheck !== undefined && (
        <button
          type="button"
          data-testid="quick-fix"
          onClick={() => props.onCreateDivisionFromRef?.("later", "worksheet")}
        />
      )}
    </>
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);

const project: Division[] = [
  { id: "1", xmlId: "doc", title: "Main", type: "article", sourceFormat: "latex", source: "Some prose.\n" },
];

function renderEditors() {
  const added: Division[] = [];
  render(
    <Editors
      divisions={project}
      rootDivisionId="doc"
      projectType="article"
      title="Doc"
      topBar={{}}
      onContentChange={() => {}}
      onDivisionAdd={(d) => {
        added.push(d);
      }}
    />,
  );
  return { added };
}

describe("typing a division placeholder", () => {
  it("creates nothing, keystroke by keystroke", () => {
    const { added } = renderEditors();
    const editor = screen.getByTestId("code-editor");
    for (const ref of ["l", "la", "lat", "late", "later"]) {
      fireEvent.change(editor, { target: { value: `Some prose.\n\\plus{worksheet}{${ref}}\n` } });
    }
    expect(added).toEqual([]);
  });

  it("creates the division from the quick fix, in the open division's format", () => {
    const { added } = renderEditors();
    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "Some prose.\n\\plus{worksheet}{later}\n" },
    });
    fireEvent.click(screen.getByTestId("quick-fix"));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ xmlId: "later", type: "worksheet", sourceFormat: "latex" });
  });
});
