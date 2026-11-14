/**
 * The page `DoenetEditorPane` frames: Doenet's own editor, loaded from the
 * same package and version PreTeXt's HTML loads, talking to the pane with
 * `postMessage`. The frame runs in `sandbox="allow-scripts"` with no
 * `allow-same-origin` — the sandbox every interactive page in the live preview
 * gets, and for the same reason: in a shared project the DoenetML it runs is a
 * collaborator's. Doenet's editor and viewer were measured to work there
 * (`docs/doenet-plan.md`).
 *
 * Protocol, page → pane: {@link DOENET_READY_MESSAGE} once the editor is
 * mounted, {@link DOENET_CHANGE_MESSAGE} with `source` from Doenet's debounced
 * change callback. Pane → page: {@link DOENET_SET_MESSAGE} with `source`, for
 * a change from outside the frame (a peer's edit, an undo). The editor's
 * `doenetML` prop is its *initial* source and the package keeps one React
 * root per container, so a set is applied by replacing the container; that
 * loses the cursor, which is why the pane sends one only for a source the
 * frame did not itself report.
 */
import { doenetStandaloneUrl } from "./index";

export const DOENET_READY_MESSAGE = "ptx-doenet-ready";
export const DOENET_CHANGE_MESSAGE = "ptx-doenet-change";
export const DOENET_SET_MESSAGE = "ptx-doenet-set";

/** The sandbox the editor frame runs in. Never add `allow-same-origin`. */
export const DOENET_EDITOR_SANDBOX = "allow-scripts";

/**
 * The editor's light/dark mode. Doenet's own `ThemeSetting` has exactly these
 * values, where `"system"` follows the browser's preference. The pane passes
 * the host's theme and falls back to light: this editor is light-only today,
 * and Doenet's editor would otherwise go dark on its own in a light page.
 */
export type DoenetEditorTheme = "light" | "dark" | "system";

export interface DoenetEditorPageOptions {
  /** The `@doenet/standalone` version to load: the document's (`effectiveDoenetmlVersion`). */
  version: string;
  /** The DoenetML the editor opens with. */
  source: string;
  readOnly?: boolean;
  /** Defaults to `"light"`. */
  theme?: DoenetEditorTheme;
}

/**
 * A JSON literal safe inside a `<script>`: `</` would end the script element
 * early, and U+2028/2029 are line terminators to JavaScript but not to JSON.
 */
const scriptLiteral = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/<\//g, "<\\/")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

// The page's own surfaces follow the theme through `color-scheme`, so the
// margins around Doenet's editor match it rather than staying white.
const PAGE_STYLE = `
html, body { margin: 0; height: 100%; background: Canvas; color: CanvasText; }
#host { height: 100%; }
#host > div { height: 100%; }
#loading { font: 13px system-ui, sans-serif; color: #666; padding: 1rem; }
#failed { display: none; font: 13px system-ui, sans-serif; color: #b91c1c; padding: 1rem; }
`;

// Kept as a plain string so the page is self-contained and the host bundles
// nothing for it. `INIT` is substituted below.
const PAGE_SCRIPT = `
var INIT = __INIT__;
var mount = null;
var current = INIT.source;
function tell(message) { parent.postMessage(message, "*"); }
function render(source) {
  // Looked up here, not at load: this script runs in the head, before the body.
  var host = document.getElementById("host");
  if (mount) mount.remove();
  mount = document.createElement("div");
  mount.setAttribute("data-doenet-add-virtual-keyboard", "false");
  host.appendChild(mount);
  current = source;
  window.renderDoenetEditorToContainer(mount, source, {
    width: "100%",
    height: "100%",
    // Code left, viewer right: the pane has the whole width, since the live
    // preview panel is withdrawn while an activity is open.
    viewerLocation: "right",
    readOnly: INIT.readOnly,
    darkMode: INIT.theme,
    doenetmlChangeCallback: function (value) {
      if (typeof value !== "string" || value === current) return;
      current = value;
      tell({ type: ${scriptLiteral(DOENET_CHANGE_MESSAGE)}, source: value });
    }
  });
}
window.addEventListener("message", function (event) {
  if (event.source !== window.parent) return;
  var data = event.data;
  if (!data || data.type !== ${scriptLiteral(DOENET_SET_MESSAGE)} || typeof data.source !== "string") return;
  if (data.source !== current) render(data.source);
});
function onLoad() {
  var loading = document.getElementById("loading");
  if (loading) loading.remove();
  try {
    render(current);
    tell({ type: ${scriptLiteral(DOENET_READY_MESSAGE)} });
  } catch (err) {
    showFailure(String(err && err.message ? err.message : err));
  }
}
function showFailure(reason) {
  var loading = document.getElementById("loading");
  if (loading) loading.remove();
  var failed = document.getElementById("failed");
  failed.style.display = "block";
  failed.textContent = "Doenet's editor could not be loaded (" + reason + ").";
}
`;

/** The complete HTML of the editor page for `options`. */
export function doenetEditorPage({
  version,
  source,
  readOnly = false,
  theme = "light",
}: DoenetEditorPageOptions): string {
  const init = scriptLiteral({ source, readOnly, theme });
  // A function, so `$&` and friends in the DoenetML are not replacement patterns.
  const script = PAGE_SCRIPT.replace("__INIT__", () => init);
  const css = doenetStandaloneUrl(version, "style.css");
  const js = doenetStandaloneUrl(version, "doenet-standalone.js");
  const colorScheme = theme === "system" ? "light dark" : theme;
  return (
    `<!DOCTYPE html><html style="color-scheme: ${colorScheme}"><head><meta charset="utf-8">` +
    `<link rel="stylesheet" href="${css}">` +
    `<style>${PAGE_STYLE}</style>` +
    `<script>${script}</script>` +
    `<script type="module" src="${js}" onload="onLoad()" onerror="showFailure('the script did not load')"></script>` +
    `</head><body><div id="host"><div id="loading">Loading Doenet's editor…</div><div id="failed"></div></div></body></html>`
  );
}
