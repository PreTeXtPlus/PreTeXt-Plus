/**
 * Orchestrates every live "auto-convert as you type" trigger for PreTeXt
 * source into ONE Monaco content-change subscription.
 *
 * Each trigger (math delimiters, angle brackets, ampersand) used to
 * subscribe to `onDidChangeModelContent` independently. That was broken:
 * Monaco dispatches one content-change event to every subscriber, in
 * registration order, synchronously — so when an earlier subscriber's own
 * `executeEdits` call fired (itself synchronously re-dispatching a nested
 * change event, which each subscriber's own `isApplying` guard correctly
 * ignored), control still returned to the *original*, outer dispatch loop
 * once that subscriber's handler had fully finished — which then went on
 * to call the *next* subscriber with the very same (now stale) event
 * object, describing a buffer an earlier subscriber had already mutated.
 * The angle-bracket trigger converting "< " to "&lt;" shifted every column
 * after it by three; the ampersand trigger, still holding the original
 * event, read its own "is the previous character a &" check against that
 * shifted buffer and happened to land exactly on the "&" of the "&lt;" an
 * earlier subscriber had just inserted — producing "&amp;lt;" instead of
 * "&lt;". Every trigger in this family replaces its match with text
 * starting in "&", so this collision wasn't a fluke of one specific pair;
 * any two of them sharing separate subscriptions could hit it.
 *
 * The fix: only one subscription exists at all. Each trigger is a plain
 * function — `(monaco, editor, change) => boolean` — tried in sequence
 * against the same fresh event, stopping at the first one that applies an
 * edit. They're mutually exclusive by construction (a single inserted
 * character can only match one trigger's shape: math requires
 * `change.text === "$"`; angle-bracket requires `">"` or single whitespace
 * with a preceding `<`; ampersand requires single whitespace with a
 * preceding `&`), so a later trigger can never run against an event a
 * sibling has already acted on and invalidated — there's nothing left in
 * the loop to reach it.
 */
import { handleAmpersandAutoConvert } from "./ampersandAutoConvert";
import { handleAngleBracketAutoConvert } from "./angleBracketAutoConvert";
import { handleMathAutoConvert } from "./mathAutoConvert";

const HANDLERS = [
  handleMathAutoConvert,
  handleAngleBracketAutoConvert,
  handleAmpersandAutoConvert,
];

/**
 * Registered from `pretextConfig.ts`'s `registerMonacoExtensions`,
 * alongside completions and spell check.
 */
export const registerAutoConvert = (
  monaco: any,
  editor: any,
): { dispose: () => void } => {
  // Guards against the content-change event a matched handler's own edit
  // synchronously triggers.
  let isApplying = false;

  const contentListener = editor.onDidChangeModelContent((event: any) => {
    if (isApplying) return;

    const changes = event?.changes;
    if (!Array.isArray(changes) || changes.length !== 1) return;
    const change = changes[0];

    isApplying = true;
    try {
      for (const handle of HANDLERS) {
        if (handle(monaco, editor, change)) break;
      }
    } finally {
      isApplying = false;
    }
  });

  return {
    dispose: () => {
      contentListener?.dispose?.();
    },
  };
};
