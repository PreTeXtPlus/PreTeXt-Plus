/**
 * Keeps a division's structural lines read-only while its model is bound to a
 * shared `Y.Text`.
 *
 * Solo editing gets this from `constrained-editor-plugin`, which reverts an
 * offending edit after the fact via `model.undo()`. That is unusable here: the
 * plugin listens to `model.onDidChangeContent`, which fires identically for
 * local typing and for a remote CRDT delta, so it would undo a peer's
 * legitimate metadata edit and — through the Monaco binding — re-broadcast that
 * undo as a deletion, diverging every client. `model.undo()` is also a blunt
 * instrument on a bound model: it pops whatever is on top of the undo stack,
 * which includes remotely-applied edits.
 *
 * So this guard *prevents* instead of reverting, and it discriminates by entry
 * point rather than by inspecting the change:
 *
 * - **Local** edits — typing, paste, cut, drag-and-drop, multi-cursor,
 *   snippets, find-and-replace, `editor.executeEdits` — all reach the model
 *   through `pushEditOperations` (that is what puts them on the undo stack).
 *   Those are checked, and a batch straying outside the editable range is
 *   dropped whole.
 * - **Remote** deltas are applied by {@link MonacoCollabBinding} with
 *   `model.applyEdits`, which is a different method and is left alone. A peer's
 *   edit therefore always lands, whatever it touches.
 *
 * Rejecting the whole batch (rather than filtering operations out of it)
 * matches the plugin, which reverts an entire change set if any part of it is
 * out of bounds — so a multi-cursor edit spanning the boundary behaves the same
 * in both modes.
 */
import { isRangeWithin, type EditRange, type LineRange } from "../components/lockedRegion";

/** Minimal shape of the Monaco model this guard patches. */
interface GuardableModel {
  pushEditOperations?: (...args: unknown[]) => unknown;
}

export interface EditGuardOptions {
  /**
   * The span the user may edit right now, or `null` when nothing is locked.
   * Read on every edit rather than cached: the guarded lines move as the body
   * grows and shrinks (a PreTeXt division's closing tag is always the model's
   * last line), and remote deltas move them without any local event.
   */
  getEditableRange: () => LineRange | null;
  /**
   * True while the editor is applying its own structural normalization (padding
   * an emptied body, trimming trailing blank lines). Those deliberately write
   * to the locked lines and must pass through.
   */
  isBypassed: () => boolean;
  /** Whether to enforce at all — false outside collaboration, where the plugin owns this. */
  isEnabled: () => boolean;
}

/**
 * Patch `model.pushEditOperations` to drop local edits that leave the editable
 * range. Returns a disposer that restores the original method; call it before
 * the model is handed to anything else (or on unmount).
 */
export const installEditGuard = (
  model: unknown,
  options: EditGuardOptions,
): (() => void) => {
  const target = model as GuardableModel | null | undefined;
  const original = target?.pushEditOperations;
  if (!target || typeof original !== "function") return () => {};

  target.pushEditOperations = function (
    this: unknown,
    ...args: unknown[]
  ): unknown {
    if (options.isEnabled() && !options.isBypassed()) {
      const editable = options.getEditableRange();
      const operations = args[1] as { range?: EditRange }[] | undefined;
      if (
        editable &&
        Array.isArray(operations) &&
        operations.some(
          (operation) =>
            operation?.range && !isRangeWithin(editable, operation.range),
        )
      ) {
        // Monaco treats a null return as "this edit produced no cursor state";
        // since we never delegate, the model is simply left untouched.
        return null;
      }
    }
    return original.apply(this, args);
  };

  return () => {
    target.pushEditOperations = original;
  };
};
