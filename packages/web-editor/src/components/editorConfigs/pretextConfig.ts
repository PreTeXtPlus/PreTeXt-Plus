import { registerMonacoTypingShortcuts } from "@pretextbook/typing-shortcuts";
import { MONACO_COMMANDS } from "../editorCommands";
import { computeLockedRegion, isRangeWithin } from "../lockedRegion";
import { registerCodeEditorCompletions } from "./pretextCompletions";
import { registerPretextLanguageConfiguration } from "./pretextLanguageConfig";
import { registerConfiguredSpellCheck } from "./spellcheck";
import type { FormatEditorConfig } from "./types";

const PRETEXT_MONACO_LANGUAGE_ID = "xml";

export const pretextConfig: FormatEditorConfig = {
  language: PRETEXT_MONACO_LANGUAGE_ID,
  registerMonacoExtensions: (monaco, editor, context) => {
    const completions = registerCodeEditorCompletions(monaco);
    // No auto-closing `<` (it would hide the element snippets), and the
    // surrounding pairs that wrap a selection.
    const languageConfiguration = registerPretextLanguageConfiguration(
      monaco,
      PRETEXT_MONACO_LANGUAGE_ID,
    );
    // Spelling needs the editor's model (markers attach to it), which is why
    // this config now takes both arguments.
    const spelling = registerConfiguredSpellCheck(
      monaco,
      editor,
      PRETEXT_MONACO_LANGUAGE_ID,
      "pretext",
    );
    // $math$/$$math$$ -> <m>/<md>, bare <, > and & escaped, double Enter or
    // Shift+Enter for a new <p>, and `theorem:` + Enter for the snippet — all
    // PreTeXt only, since LaTeX and Markdown treat `$` as their own syntax.
    const typingShortcuts = registerMonacoTypingShortcuts(monaco, editor, {
      // A peer's edit is converted on the peer's side; converting it here too
      // would send the conversion twice.
      isRemoteChange: context.isRemoteChange,
      // An edit reaching into the locked wrapper lines would be reverted by
      // the constrained-editor plugin (or refused by the collab edit guard).
      canEdit: (range) => {
        const model = editor.getModel();
        const region = model ? computeLockedRegion(model, "pretext") : null;
        return !region || isRangeWithin(region.editableRange, range);
      },
    });
    // The package registers "Wrap Selection in Element" without a key, so the
    // shortcut the Edit menu shows is bound here. Monaco registers an editor
    // action's command as `<editor id>:<action id>`; binding that one (rather
    // than adding a second action) keeps a single palette entry, which then
    // shows the key, and the `editorId` condition keeps it to this editor.
    const wrapSelectionKey = monaco.editor.addKeybindingRule?.({
      keybinding: monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyW,
      command: `${editor.getId()}:${MONACO_COMMANDS.wrapSelection.id}`,
      when: `editorId == '${editor.getId()}' && !editorReadonly`,
    });

    return {
      dispose: () => {
        wrapSelectionKey?.dispose();
        typingShortcuts.dispose();
        spelling?.dispose();
        completions?.dispose?.();
        languageConfiguration.dispose();
      },
    };
  },
};
