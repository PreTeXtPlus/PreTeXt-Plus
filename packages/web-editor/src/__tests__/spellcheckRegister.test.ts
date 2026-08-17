import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerSpellCheck,
  SPELLCHECK_MARKER_OWNER,
} from "../components/editorConfigs/spellcheck/register";
import { resetDictionaryCache } from "../components/editorConfigs/spellcheck/dictionary";

/**
 * A dictionary that knows a handful of words, served through a stubbed `fetch`
 * so `registerSpellCheck` exercises its real loading path. The `.aff`/`.dic`
 * pair is the smallest Hunspell input nspell accepts.
 */
const KNOWN = ["the", "theorem", "proof", "and", "Cauchy"];

const stubDictionaryFetch = () => {
  const dic = [`${KNOWN.length}`, ...KNOWN].join("\n");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => (url.endsWith(".aff") ? "SET UTF-8\n" : dic),
    })),
  );
};

/** Minimal stand-ins for the parts of Monaco this module touches. */
const makeModel = (value: string) => {
  const listeners: Array<() => void> = [];
  return {
    uri: "inmemory://test",
    getValue: () => value,
    getVersionId: () => 1,
    isDisposed: () => false,
    onDidChangeContent: (fn: () => void) => {
      listeners.push(fn);
      return { dispose: () => {} };
    },
    // Single-line documents keep the offset→position mapping trivial.
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getValueInRange: (range: any) =>
      value.slice(range.startColumn - 1, range.endColumn - 1),
  };
};

const makeMonaco = () => {
  const markers: Record<string, any[]> = {};
  return {
    markers,
    MarkerSeverity: { Info: 2, Warning: 4, Error: 8 },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: {
      setModelMarkers: (_model: any, owner: string, next: any[]) => {
        markers[owner] = next;
      },
    },
    languages: {
      registerCodeActionProvider: (_lang: string, provider: any) => {
        (makeMonaco as any).lastProvider = provider;
        return { dispose: () => {} };
      },
    },
  };
};

const makeEditor = (model: any) => {
  const commands: Record<string, (...args: unknown[]) => void> = {};
  let next = 0;
  return {
    commands,
    getModel: () => model,
    addCommand: (_key: number, handler: (...args: unknown[]) => void) => {
      const id = `cmd-${next++}`;
      commands[id] = handler;
      return id;
    },
  };
};

/** Lets the dictionary load and the first check publish. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("registerSpellCheck", () => {
  beforeEach(() => {
    resetDictionaryCache();
    stubDictionaryFetch();
  });

  it("publishes a marker for the misspelled word only", async () => {
    const model = makeModel("<p>the teorem and the proof</p>");
    const monaco = makeMonaco();
    const handle = registerSpellCheck(monaco, makeEditor(model), {
      monacoLanguageId: "xml",
    });
    await settle();

    const published = monaco.markers[SPELLCHECK_MARKER_OWNER];
    expect(published.map((m: any) => m.message)).toEqual([
      '"teorem" is not in the dictionary.',
    ]);
    expect(published[0].severity).toBe(monaco.MarkerSeverity.Info);
    handle?.dispose();
  });

  it("does not flag words inside ignored scopes", async () => {
    const model = makeModel("<p>the <m>teorem</m> proof</p>");
    const monaco = makeMonaco();
    const handle = registerSpellCheck(monaco, makeEditor(model), {
      monacoLanguageId: "xml",
    });
    await settle();

    expect(monaco.markers[SPELLCHECK_MARKER_OWNER]).toEqual([]);
    handle?.dispose();
  });

  it("clears its markers on dispose", async () => {
    const model = makeModel("<p>teorem</p>");
    const monaco = makeMonaco();
    const handle = registerSpellCheck(monaco, makeEditor(model), {
      monacoLanguageId: "xml",
    });
    await settle();
    expect(monaco.markers[SPELLCHECK_MARKER_OWNER]).toHaveLength(1);

    handle?.dispose();
    expect(monaco.markers[SPELLCHECK_MARKER_OWNER]).toEqual([]);
  });

  it("offers suggestions plus add and ignore quick fixes", async () => {
    const model = makeModel("<p>teorem</p>");
    const monaco = makeMonaco();
    const handle = registerSpellCheck(monaco, makeEditor(model), {
      monacoLanguageId: "xml",
    });
    await settle();

    const marker = monaco.markers[SPELLCHECK_MARKER_OWNER][0];
    const provider = (makeMonaco as any).lastProvider;
    const { actions } = provider.provideCodeActions(model, null, {
      markers: [marker],
    });

    const titles = actions.map((a: any) => a.title);
    expect(titles).toContain("theorem");
    expect(titles).toContain('Add "teorem" to dictionary');
    expect(titles).toContain('Ignore "teorem" this session');
    // The correction must arrive as an edit Monaco can apply directly.
    const fix = actions.find((a: any) => a.title === "theorem");
    expect(fix.edit.edits[0].textEdit.text).toBe("theorem");
    handle?.dispose();
  });

  it("ignores markers that belong to another provider", async () => {
    const model = makeModel("<p>teorem</p>");
    const monaco = makeMonaco();
    const handle = registerSpellCheck(monaco, makeEditor(model), {
      monacoLanguageId: "xml",
    });
    await settle();

    const provider = (makeMonaco as any).lastProvider;
    const { actions } = provider.provideCodeActions(model, null, {
      markers: [{ source: "pretext-schema", startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }],
    });
    expect(actions).toEqual([]);
    handle?.dispose();
  });

  it("stops flagging a word once it is added, under either command-argument shape", async () => {
    for (const invoke of [
      (fn: any, word: string) => fn({}, word), // spread arguments
      (fn: any, word: string) => fn({}, [word]), // arguments as an array
    ]) {
      resetDictionaryCache();
      stubDictionaryFetch();
      const model = makeModel("<p>teorem</p>");
      const monaco = makeMonaco();
      const editor = makeEditor(model);
      const handle = registerSpellCheck(monaco, editor, {
        monacoLanguageId: "xml",
      });
      await settle();
      expect(monaco.markers[SPELLCHECK_MARKER_OWNER]).toHaveLength(1);

      invoke(editor.commands["cmd-0"], "teorem");
      await settle();
      expect(monaco.markers[SPELLCHECK_MARKER_OWNER]).toEqual([]);
      handle?.dispose();
    }
  });

  it("leaves the editor unmarked when the dictionary cannot be fetched", async () => {
    resetDictionaryCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = makeModel("<p>teorem</p>");
    const monaco = makeMonaco();
    const handle = registerSpellCheck(monaco, makeEditor(model), {
      monacoLanguageId: "xml",
    });
    await settle();

    expect(monaco.markers[SPELLCHECK_MARKER_OWNER]).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    handle?.dispose();
    warn.mockRestore();
  });

  it("persists added words through a host store", async () => {
    const added: string[] = [];
    const model = makeModel("<p>teorem</p>");
    const monaco = makeMonaco();
    const editor = makeEditor(model);
    const handle = registerSpellCheck(monaco, editor, {
      monacoLanguageId: "xml",
      userWordStore: {
        load: () => [],
        add: (word) => {
          added.push(word);
        },
      },
    });
    await settle();

    editor.commands["cmd-0"]({}, "teorem");
    await settle();
    expect(added).toEqual(["teorem"]);
    handle?.dispose();
  });

  it("starts clean for a word the store already knows", async () => {
    const model = makeModel("<p>teorem</p>");
    const monaco = makeMonaco();
    const handle = registerSpellCheck(monaco, makeEditor(model), {
      monacoLanguageId: "xml",
      userWordStore: { load: () => ["teorem"] },
    });
    await settle();

    expect(monaco.markers[SPELLCHECK_MARKER_OWNER]).toEqual([]);
    handle?.dispose();
  });
});
