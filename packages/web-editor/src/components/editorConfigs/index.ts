import type { SourceFormat } from "../../types/editor";
import type { FormatEditorConfig } from "./types";
import { pretextConfig } from "./pretextConfig";
import { latexConfig } from "./latexConfig";
import { markdownConfig } from "./markdownConfig";

export const editorConfigs: Record<SourceFormat, FormatEditorConfig> = {
  pretext: pretextConfig,
  latex: latexConfig,
  markdown: markdownConfig,
};

export type { FormatEditorConfig };
