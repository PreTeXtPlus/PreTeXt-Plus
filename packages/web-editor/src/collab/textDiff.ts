import type * as Y from "yjs";
import { normalizeLineEndings } from "../lineEndings";

/**
 * Replace a `Y.Text`'s content with `next` using the smallest single
 * delete+insert: the common prefix and suffix are retained, so concurrent
 * remote edits in the untouched regions survive the replacement. Used for
 * source rewrites that arrive as whole strings (TOC reorders, metadata
 * rewrites, format conversions) rather than as editor keystrokes — keystrokes
 * flow through the Monaco binding, which already emits precise deltas.
 *
 * Must be called inside a `doc.transact(...)` so observers see one change.
 */
export const diffReplace = (ytext: Y.Text, next: string): void => {
  // Shared text holds `\n` only (see `lineEndings.ts`).
  next = normalizeLineEndings(next);
  const current = ytext.toString();
  if (current === next) return;

  let start = 0;
  const minLength = Math.min(current.length, next.length);
  while (start < minLength && current[start] === next[start]) start++;

  let currentEnd = current.length;
  let nextEnd = next.length;
  while (
    currentEnd > start &&
    nextEnd > start &&
    current[currentEnd - 1] === next[nextEnd - 1]
  ) {
    currentEnd--;
    nextEnd--;
  }

  if (currentEnd > start) ytext.delete(start, currentEnd - start);
  if (nextEnd > start) ytext.insert(start, next.slice(start, nextEnd));
};

/**
 * Take the `\r` out of every `\r\n` in a `Y.Text`, in place, and say whether
 * there was one. For text written before the editor kept to `\n` (see
 * `lineEndings.ts`).
 *
 * Deletions only, which is what makes it safe for every client that joins to
 * do: two peers removing the same character converge on its being removed
 * once, where two peers *replacing* it would each insert a copy. That is also
 * why a lone `\r` is left alone — turning it into `\n` is an insert — and it
 * can be: Monaco reads it as a line break of the same length, so nothing
 * drifts, and the host stores it as `\n`.
 *
 * Must be called inside a `doc.transact(...)`.
 */
export const stripCarriageReturns = (ytext: Y.Text): boolean => {
  const current = ytext.toString();
  if (!current.includes("\r\n")) return false;
  // Back to front, so each index is still that of the text as read.
  for (let at = current.lastIndexOf("\r\n"); at !== -1; at = at === 0 ? -1 : current.lastIndexOf("\r\n", at - 1)) {
    ytext.delete(at, 1);
  }
  return true;
};
