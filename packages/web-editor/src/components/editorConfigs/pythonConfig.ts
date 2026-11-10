import type { FormatEditorConfig } from "./types";

/**
 * Python, for a Sage plot's source. Monaco ships this language
 * (`basic-languages/python`), so there is nothing to register: highlighting and
 * bracket matching come with it, and nothing of ours is added — no completions,
 * no lint — since the source runs on a build server, not here.
 */
export const pythonConfig: FormatEditorConfig = {
  language: "python",
};
