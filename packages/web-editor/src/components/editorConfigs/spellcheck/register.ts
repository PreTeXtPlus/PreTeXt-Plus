import {
  loadDictionary,
  DEFAULT_DICTIONARY_SOURCE,
  type DictionarySource,
  type SpellDictionary,
} from "./dictionary";
import { DEFAULT_SPELL_CHECK_SCOPES, type SpellCheckScope } from "./scopes";
import { UserWords, type UserWordStore } from "./userWords";
import { extractWords, splitCompound, type FoundWord } from "./words";
import { findCheckableRegions } from "./xmlRegions";

/**
 * Marker owner for spelling diagnostics.
 *
 * Must differ from every other owner used against the same model — Monaco's
 * `setModelMarkers` replaces *all* markers for an owner, so sharing one with
 * the flavor linters (which own theirs by `flavor.languageId`, see
 * `flavorLanguage.ts`) would make each publish wipe the other's diagnostics.
 */
export const SPELLCHECK_MARKER_OWNER = "pretext-spellcheck";

/** `source` on each marker, so the code action provider can spot its own. */
const MARKER_SOURCE = "spelling";

/** Beyond this, the document is not prose and markers would be a wall of noise. */
const MAX_MARKERS = 500;

/** Suggestions offered per misspelling. nspell orders them best-first. */
const MAX_SUGGESTIONS = 6;

export interface SpellCheckOptions {
  /** Monaco language id the model uses, for the code action provider. */
  monacoLanguageId: string;
  /** Which PreTeXt constructs to look inside. Defaults to {@link DEFAULT_SPELL_CHECK_SCOPES}. */
  scopes?: SpellCheckScope;
  /** Where to fetch the Hunspell files from. */
  dictionarySource?: DictionarySource;
  /** Optional persistence for "Add to dictionary". */
  userWordStore?: UserWordStore;
  /** How long to wait after the last keystroke before re-checking. */
  debounceMs?: number;
}

/**
 * Spell checks the editor's model and publishes the misspellings as Monaco
 * markers, with quick fixes to correct, add, or ignore each word.
 *
 * Returns a disposable that clears the markers and unregisters the provider —
 * `CodeEditor` calls it when the source format changes or the editor unmounts,
 * exactly as it does for the flavor linters.
 *
 * Everything here fails soft. If the dictionary can't be fetched the editor
 * simply has no spelling markers; nothing else changes.
 */
export const registerSpellCheck = (
  monaco: any,
  editor: any,
  options: SpellCheckOptions,
): { dispose: () => void } | null => {
  const model = editor?.getModel?.();
  if (!model) return null;

  const {
    monacoLanguageId,
    scopes = DEFAULT_SPELL_CHECK_SCOPES,
    dictionarySource = DEFAULT_DICTIONARY_SOURCE,
    userWordStore,
    debounceMs = 500,
  } = options;

  const userWords = new UserWords(userWordStore);
  let dictionary: SpellDictionary | null = null;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const check = async () => {
    if (!dictionary || disposed || model.isDisposed?.()) return;
    const source = model.getValue();
    const words = extractWords(source, findCheckableRegions(source, scopes));

    const markers: any[] = [];
    for (const found of words) {
      if (markers.length >= MAX_MARKERS) break;
      if (isSpelledCorrectly(dictionary, userWords, found.word)) continue;
      markers.push(toMarker(monaco, model, found));
    }
    monaco.editor.setModelMarkers(model, SPELLCHECK_MARKER_OWNER, markers);
  };

  const scheduleCheck = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), debounceMs);
  };

  // Commands backing the "add" and "ignore" quick fixes. A keybinding of 0
  // gives us an id we can name from a code action without binding a key.
  //
  // Monaco hands command handlers a services accessor first and the code
  // action's `arguments` after it, but whether those arrive spread or as a
  // single array has differed across builds. Picking the first string out of
  // the arguments is correct under either, and costs nothing.
  const wordFrom = (args: unknown[]): string | undefined =>
    args.flat().find((arg): arg is string => typeof arg === "string");

  const addCommandId = editor.addCommand(0, (...args: unknown[]) => {
    const word = wordFrom(args.slice(1));
    if (!word) return;
    userWords.add(word);
    dictionary?.add(word);
    void check();
  });
  const ignoreCommandId = editor.addCommand(0, (...args: unknown[]) => {
    const word = wordFrom(args.slice(1));
    if (!word) return;
    userWords.ignore(word);
    void check();
  });

  const codeActions = monaco.languages.registerCodeActionProvider(
    monacoLanguageId,
    {
      provideCodeActions: (target: any, _range: any, context: any) => {
        const actions: any[] = [];
        // `context.markers` is already narrowed to the markers overlapping the
        // cursor, so this only ever sees the word actually being fixed.
        for (const marker of context?.markers ?? []) {
          if (marker.source !== MARKER_SOURCE) continue;
          const range = new monaco.Range(
            marker.startLineNumber,
            marker.startColumn,
            marker.endLineNumber,
            marker.endColumn,
          );
          // Read the word back off the model rather than off the marker: an
          // edit elsewhere may have shifted the range since it was published,
          // and Monaco has already moved the marker with it.
          const word = target.getValueInRange(range);
          if (!word) continue;

          for (const suggestion of dictionary?.suggest(word).slice(0, MAX_SUGGESTIONS) ?? []) {
            actions.push({
              title: suggestion,
              kind: "quickfix",
              diagnostics: [marker],
              edit: {
                edits: [
                  {
                    resource: target.uri,
                    versionId: target.getVersionId(),
                    textEdit: { range, text: suggestion },
                  },
                ],
              },
            });
          }
          actions.push({
            title: `Add "${word}" to dictionary`,
            kind: "quickfix",
            diagnostics: [marker],
            command: {
              id: addCommandId,
              title: "Add to dictionary",
              arguments: [word],
            },
          });
          actions.push({
            title: `Ignore "${word}" this session`,
            kind: "quickfix",
            diagnostics: [marker],
            command: {
              id: ignoreCommandId,
              title: "Ignore word",
              arguments: [word],
            },
          });
        }
        return { actions, dispose: () => {} };
      },
    },
  );

  const subscription = model.onDidChangeContent(scheduleCheck);

  // Load the dictionary and the author's own words in parallel, then do the
  // first pass. Until this resolves the editor simply has no spelling markers.
  void (async () => {
    const [loaded] = await Promise.all([
      loadDictionary(dictionarySource),
      userWords.hydrate(),
    ]);
    if (disposed) return;
    dictionary = loaded;
    void check();
  })();

  return {
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      subscription?.dispose?.();
      codeActions?.dispose?.();
      if (!model.isDisposed?.()) {
        monaco.editor.setModelMarkers(model, SPELLCHECK_MARKER_OWNER, []);
      }
    },
  };
};

/**
 * Accepts a word if the author has taught it to us, if the dictionary knows it,
 * if it is a possessive of a known word, or if it is CamelCase whose parts are
 * all known.
 */
const isSpelledCorrectly = (
  dictionary: SpellDictionary,
  userWords: UserWords,
  word: string,
): boolean => {
  if (userWords.has(word)) return true;
  if (dictionary.correct(word)) return true;

  // Hunspell word lists carry the lemma, not `author's`, so a possessive that
  // reaches here is judged on its stem.
  const possessive = /['’]s$/.exec(word);
  if (possessive) {
    const stem = word.slice(0, -2);
    if (userWords.has(stem) || dictionary.correct(stem)) return true;
  }

  const parts = splitCompound(word);
  if (parts.length > 1) {
    return parts.every(
      (part) => userWords.has(part) || dictionary.correct(part),
    );
  }

  return false;
};

const toMarker = (monaco: any, model: any, found: FoundWord) => {
  const start = model.getPositionAt(found.start);
  const end = model.getPositionAt(found.end);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    message: `"${found.word}" is not in the dictionary.`,
    source: MARKER_SOURCE,
    // Info, not Warning: a misspelling is worth a faint squiggle, but it must
    // not sit in the problems list alongside markup errors that break a build.
    severity: monaco.MarkerSeverity.Info,
  };
};
