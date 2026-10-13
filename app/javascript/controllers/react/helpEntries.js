/**
 * Static help links, matching `app/views/layouts/_help_menu.html.erb`
 * exactly (labels, targets, order). Wrapped by `buildHelpMenu` below.
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
];

/**
 * Builds the `TopBar` Help menu shared by `editor.jsx`, `tryit.jsx` and
 * `shared_source.jsx`, mirroring `app/views/layouts/_help_menu.html.erb`.
 * The last entry opens the in-app feedback form when `onGiveFeedback` is
 * given, and falls back to emailing support otherwise.
 *
 * @param {Object} [props]
 * @param {() => void} [props.onGiveFeedback]
 * @returns {{ label: string, entries: import("@pretextbook/web-editor").MenuEntry[] }}
 */
export function buildHelpMenu({ onGiveFeedback } = {}) {
  return {
    label: "Help",
    entries: [
      ...HELP_ENTRIES,
      { kind: "separator", key: "support-sep" },
      onGiveFeedback
        ? {
            kind: "item",
            key: "support",
            label: "Support / Feedback",
            onSelect: onGiveFeedback,
          }
        : {
            kind: "item",
            key: "support",
            label: "Email Support",
            onSelect: () => {
              window.location.href = "mailto:support@pretext.plus";
            },
          },
    ],
  };
}
