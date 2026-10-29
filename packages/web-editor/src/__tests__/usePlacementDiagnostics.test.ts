/**
 * The Monaco side of the placement check: markers published for the editor's
 * model, and the quick fix offered for them. Monaco itself is stood in for by
 * the few calls the hook makes.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePlacementDiagnostics } from "../components/editorConfigs/usePlacementDiagnostics";
import { placementUses, type PlacementCheckInput } from "../components/editorConfigs/placementDiagnostics";

function fakeMonaco(text: string) {
  const model = {
    uri: "inmemory://buffer",
    getValue: () => text,
    getVersionId: () => 7,
    isDisposed: () => false,
    onDidChangeContent: () => ({ dispose() {} }),
    getPositionAt: (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
    },
    getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) =>
      text.split("\n").slice(0, lineNumber - 1).reduce((n, line) => n + line.length + 1, 0) + column - 1,
  };
  const providers: Record<string, { provideCodeActions: (...args: unknown[]) => { actions: any[] } }> = {};
  const monaco = {
    MarkerSeverity: { Warning: 4, Error: 8 },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: { setModelMarkers: vi.fn() },
    languages: {
      registerCodeActionProvider: vi.fn((id: string, provider: any) => {
        providers[id] = provider;
        return { dispose: () => delete providers[id] };
      }),
    },
  };
  const editor = { getModel: () => model };
  return { monaco, editor, model, providers };
}

describe("usePlacementDiagnostics", () => {
  it("marks an unnamed second placement and offers to name it", () => {
    const text = 'Intro\n<plus:image ref="graph"/>';
    const { monaco, editor, model, providers } = fakeMonaco(text);
    const input: PlacementCheckInput = {
      sourceFormat: "pretext",
      recordRef: "sec-intro",
      elsewhere: placementUses([{ name: "Methods", source: '<plus:image ref="graph"/>', sourceFormat: "pretext" }]),
      knownRefs: new Set(["graph"]),
    };

    const { unmount } = renderHook(() =>
      usePlacementDiagnostics({ current: monaco }, { current: editor }, input, true, ["xml", "xml"]),
    );

    const calls = monaco.editor.setModelMarkers.mock.calls;
    const [, owner, markers] = calls[calls.length - 1];
    expect(owner).toBe("pretext-placements");
    expect(markers).toEqual([
      expect.objectContaining({ severity: 4, source: "placements", startLineNumber: 2, startColumn: 1, endColumn: 26 }),
    ]);
    // One provider per language, however many formats share it.
    expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledTimes(1);

    const { actions } = providers.xml.provideCodeActions(model, null, {
      markers: [...markers, { ...markers[0], source: "spelling" }],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Name this placement "sec-intro"');
    expect(actions[0].edit.edits[0].textEdit.text).toBe('<plus:image ref="graph" instance="sec-intro"/>');

    unmount();
    expect(providers.xml).toBeUndefined();
  });

  it("clears its markers when there is nothing to check", () => {
    const { monaco, editor } = fakeMonaco('<plus:image ref="graph"/>');
    renderHook(() => usePlacementDiagnostics({ current: monaco }, { current: editor }, undefined, true, ["xml"]));
    expect(monaco.editor.setModelMarkers).toHaveBeenLastCalledWith(expect.anything(), "pretext-placements", []);
  });
});
