import type { EditorLanguage } from "../../types/editor";
import type { FormatEditorConfig } from "./types";
import { pretextConfig } from "./pretextConfig";
import { latexConfig } from "./latexConfig";
import { markdownConfig } from "./markdownConfig";
import { texConfig } from "./texConfig";

export const editorConfigs: Record<EditorLanguage, FormatEditorConfig> = {
  pretext: pretextConfig,
  latex: latexConfig,
  markdown: markdownConfig,
  tex: texConfig,
};

export type { FormatEditorConfig };
