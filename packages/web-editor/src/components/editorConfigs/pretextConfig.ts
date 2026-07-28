import { registerCodeEditorCompletions } from "./pretextCompletions";
import type { FormatEditorConfig } from "./types";

export const pretextConfig: FormatEditorConfig = {
  language: "xml",
  registerMonacoExtensions: (monaco) => registerCodeEditorCompletions(monaco),
};
