/**
 * @vitest-environment jsdom
 *
 * The imperative half of the editor menus, against a stub editor. Monaco's own
 * behavior isn't under test here — what is, is the part this package decides:
 * which entry point each operation uses, and what happens when the browser or
 * the editor build refuses to cooperate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MONACO_COMMANDS,
  copySelection,
  cutSelection,
  formatShortcut,
  insertSnippet,
  pasteFromClipboard,
  runEditorCommand,
} from "../components/editorCommands";

/** A Monaco stand-in: a model holding one line, and a recorded selection. */
const makeEditor = (
  options: {
    text?: string;
    empty?: boolean;
    actions?: Record<string, () => void>;
    snippetController?: boolean;
  } = {},
) => {
  const { text = "selected", empty = false } = options;
  const edits: { text: string }[] = [];
  const inserted: string[] = [];
  const triggered: string[] = [];
  const selection = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: empty ? 1 : text.length + 1,
    isEmpty: () => empty,
  };
  return {
    edits,
    inserted,
    triggered,
    focus: vi.fn(),
    getModel: () => ({ getValueInRange: () => text }),
    getSelection: () => selection,
    executeEdits: (_source: string, ops: any[]) => {
      edits.push(...ops);
    },
    getAction: (id: string) =>
      options.actions?.[id] ? { run: options.actions[id] } : undefined,
    trigger: (_source: string, id: string) => {
      triggered.push(id);
    },
    getContribution: (id: string) =>
      options.snippetController && id === "snippetController2"
        ? { insert: (body: string) => inserted.push(body) }
        : undefined,
  };
};

/** Install a clipboard stub; returns the text it holds. */
const stubClipboard = (behavior: {
  write?: (text: string) => Promise<void>;
  read?: () => Promise<string>;
}) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: behavior.write ?? (async () => {}),
      readText: behavior.read ?? (async () => ""),
    },
  });
};

beforeEach(() => {
  stubClipboard({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runEditorCommand", () => {
  it("focuses the editor before running, so widgets open against it", () => {
    const run = vi.fn();
    const editor = makeEditor({ actions: { "actions.find": run } });
    runEditorCommand(editor, MONACO_COMMANDS.find.id);

    expect(editor.focus).toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
  });

  it("falls back to trigger for core commands with no registered action", () => {
    const editor = makeEditor();
    runEditorCommand(editor, MONACO_COMMANDS.undo.id);
    expect(editor.triggered).toEqual(["undo"]);
  });

  it("does nothing before Monaco has loaded", () => {
    expect(() => runEditorCommand(null, MONACO_COMMANDS.find.id)).not.toThrow();
  });
});

describe("clipboard operations", () => {
  it("copies the selected text", async () => {
    const write = vi.fn(async () => {});
    stubClipboard({ write });
    expect(await copySelection(makeEditor({ text: "hello" }))).toBe(true);
    expect(write).toHaveBeenCalledWith("hello");
  });

  it("reports a refusal instead of failing silently", async () => {
    stubClipboard({
      write: async () => {
        throw new Error("blocked");
      },
    });
    expect(await copySelection(makeEditor())).toBe(false);
  });

  it("treats an empty selection as a no-op, not a failure", async () => {
    const write = vi.fn(async () => {});
    stubClipboard({ write });
    expect(await copySelection(makeEditor({ empty: true }))).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("deletes the selection only once the copy has landed", async () => {
    const editor = makeEditor({ text: "gone" });
    expect(await cutSelection(editor)).toBe(true);
    expect(editor.edits).toEqual([
      expect.objectContaining({ text: "", forceMoveMarkers: true }),
    ]);
  });

  it("leaves the buffer alone when the clipboard write is refused", async () => {
    stubClipboard({
      write: async () => {
        throw new Error("blocked");
      },
    });
    const editor = makeEditor({ text: "kept" });
    expect(await cutSelection(editor)).toBe(false);
    expect(editor.edits).toEqual([]);
  });

  it("pastes what the clipboard holds over the selection", async () => {
    stubClipboard({ read: async () => "pasted" });
    const editor = makeEditor();
    expect(await pasteFromClipboard(editor)).toBe(true);
    expect(editor.edits[0].text).toBe("pasted");
  });

  it("reports a blocked clipboard read rather than pasting nothing", async () => {
    stubClipboard({
      read: async () => {
        throw new Error("blocked");
      },
    });
    const editor = makeEditor();
    expect(await pasteFromClipboard(editor)).toBe(false);
    expect(editor.edits).toEqual([]);
  });
});

describe("insertSnippet", () => {
  it("hands the body to Monaco's snippet session, tab stops intact", () => {
    const editor = makeEditor({ snippetController: true });
    insertSnippet(editor, "<p>$0</p>");
    expect(editor.inserted).toEqual(["<p>$0</p>"]);
    expect(editor.edits).toEqual([]);
  });

  it("writes plain text when the snippet contribution is missing", () => {
    const editor = makeEditor();
    insertSnippet(editor, '<xref ref="${1:xml-id}"/>');
    expect(editor.inserted).toEqual([]);
    expect(editor.edits[0].text).toBe('<xref ref="xml-id"/>');
  });
});

describe("formatShortcut", () => {
  it("names the modifier the platform uses", () => {
    expect(formatShortcut("Mod+Z", false)).toBe("Ctrl+Z");
    expect(formatShortcut("Mod+Z", true)).toBe("⌘Z");
    expect(formatShortcut("Mod+Shift+Z", true)).toBe("⌘⇧Z");
  });
});
