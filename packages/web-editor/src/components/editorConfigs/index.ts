import type { EditorLanguage } from "../../types/editor";
import type { FormatEditorConfig } from "./types";
import { pretextConfig } from "./pretextConfig";
import { latexConfig } from "./latexConfig";
import { markdownConfig } from "./markdownConfig";
import { texConfig } from "./texConfig";
import { asymptoteConfig } from "./asymptoteConfig";
import { pythonConfig } from "./pythonConfig";

export const editorConfigs: Record<EditorLanguage, FormatEditorConfig> = {
  pretext: pretextConfig,
  latex: latexConfig,
  markdown: markdownConfig,
  tex: texConfig,
  asymptote: asymptoteConfig,
  python: pythonConfig,
};

export type { FormatEditorConfig };
