import { registerAutoConvert } from "./autoConvert";
import { registerCodeEditorCompletions } from "./pretextCompletions";
import { registerConfiguredSpellCheck } from "./spellcheck";
import type { FormatEditorConfig } from "./types";

const PRETEXT_MONACO_LANGUAGE_ID = "xml";

export const pretextConfig: FormatEditorConfig = {
  language: PRETEXT_MONACO_LANGUAGE_ID,
  registerMonacoExtensions: (monaco, editor) => {
    const completions = registerCodeEditorCompletions(monaco);
    // Spelling needs the editor's model (markers attach to it), which is why
    // this config now takes both arguments.
    const spelling = registerConfiguredSpellCheck(
      monaco,
      editor,
      PRETEXT_MONACO_LANGUAGE_ID,
      "pretext",
    );
    // $math$/$$math$$ -> <m>/<md>, stray "< "/" >" -> "&lt;"/"&gt;", and
    // stray "& " -> "&amp;" — all live, PreTeXt only, from one shared
    // content-change subscription (see autoConvert.ts for why they must
    // share one rather than each registering separately).
    const autoConvert = registerAutoConvert(monaco, editor);

    return {
      dispose: () => {
        autoConvert?.dispose();
        spelling?.dispose();
        completions?.dispose?.();
      },
    };
  },
};
