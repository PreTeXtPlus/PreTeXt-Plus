/**
 * Static help links, matching `app/views/layouts/_nav_dropdown.html.erb`'s
 * Help menu exactly (labels, targets, order). Shared by `editor.jsx` and
 * `tryit.jsx`, which each build their own `helpMenu` for `TopBar` around it.
 * @type {import("@pretextbook/web-editor").MenuEntry[]}
 */
export const HELP_ENTRIES = [
  {
    kind: "item",
    key: "docs",
    label: "PreTeXt.Plus Documentation",
    onSelect: () => window.open("https://docs.pretext.plus", "_blank"),
  },
  {
    kind: "item",
    key: "guide",
    label: "PreTeXt Guide",
    onSelect: () =>
      window.open("https://pretextbook.org/doc/guide/html/", "_blank"),
  },
  {
    kind: "item",
    key: "sample",
    label: "PreTeXt Sample Article",
    onSelect: () =>
      window.open(
        "https://pretextbook.org/examples/sample-article/annotated/",
        "_blank",
      ),
  },
  {
    kind: "item",
    key: "support",
    label: "Email Support",
    onSelect: () => window.open("mailto:support@pretext.plus", "_blank"),
  },
];
