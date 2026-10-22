/**
 * Host entries appended to the editor's Tools menu (`topBar.toolsEntries`),
 * shared by `editor.jsx`, `tryit.jsx` and `shared_source.jsx`.
 * @type {import("@pretextbook/web-editor").MenuEntry[]}
 */
export const TOOLS_ENTRIES = [
  {
    kind: "item",
    key: "labs",
    label: "PreTeXt.Plus Labs",
    onSelect: () => window.open("https://labs.pretext.plus", "_blank"),
  },
];
