import type * as Y from "yjs";

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
