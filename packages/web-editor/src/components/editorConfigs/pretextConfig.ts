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

    return {
      dispose: () => {
        spelling?.dispose();
        completions?.dispose?.();
      },
    };
  },
};
