/**
 * Live escaping of a stray `&` into `&amp;` as the author types PreTeXt
 * (XML) source: `Alice & Bob` becomes `Alice &amp; Bob` the moment the
 * space after the `&` is typed.
 *
 * `&` is unambiguous on its own, exactly like `<`: a real XML entity or
 * character reference (`&amp;`, `&#960;`, …) must have a name or `#digits`
 * immediately after the `&`, never whitespace, so `& ` can never be the
 * start of one. Unlike `<`, `&` isn't part of a bracket pair — Monaco's
 * `xml` language doesn't auto-close it into anything — so there's no
 * dangling-character cleanup to do here the way there is for `<>`.
 *
 * PreTeXt-only — LaTeX and Markdown source aren't XML and don't need this —
 * so this trigger is only tried from `autoConvert.ts`'s shared subscription,
 * which `pretextConfig.ts` registers.
 */
import { computeLockedRegion } from "../lockedRegion";
import { isXmlTextPosition } from "./xmlTags";

/**
 * Finds the `&` that a single whitespace character just inserted at
 * `insertColumn` (1-based, Monaco's `change.range.startColumn` for the
 * edit — the position *where* the character was inserted) immediately
 * follows, if any.
 *
 * Works uniformly whether the whitespace is a space/tab typed mid-line or a
 * newline from pressing Enter, for the same reason `findLessThanEscape`
 * does: `lineText` is read from the model *after* the edit, and in both
 * cases it holds the line's content only up to the insertion point.
 *
 * Returns the 1-based column of the `&` character itself, or `null`.
 */
export const findAmpersandEscape = (
  lineText: string,
  insertColumn: number,
): number | null => {
  const ampIdx = insertColumn - 2;
  if (ampIdx < 0 || lineText[ampIdx] !== "&") return null;
  return ampIdx + 1;
};

/**
 * Applies {@link findAmpersandEscape} against one Monaco content-change
 * `change`, guarded by {@link isXmlTextPosition} so a `&` that's already
 * legitimately raw — inside a comment, a CDATA section, or an attribute
 * value — is left alone. Called from `autoConvert.ts`'s single shared
 * `onDidChangeModelContent` subscription (alongside the other PreTeXt
 * auto-convert triggers; see that file for why they all share one
 * subscription rather than each registering their own). Returns `true` if
 * it matched and applied its edit.
 *
 * No custom undo is wired up here: an explicit `model.pushStackElement()`
 * on each side of the edit (see below) is enough to make Ctrl+Z/Cmd+Z
 * immediately after a conversion revert just the conversion, via Monaco's
 * ordinary undo stack — the same fix `mathAutoConvert.ts` needed, applied
 * here from the start.
 */
export const handleAmpersandAutoConvert = (
  monaco: any,
  editor: any,
  change: any,
): boolean => {
  if (change.rangeLength !== 0 || change.text?.length !== 1 || !/\s/.test(change.text)) {
    return false;
  }

  const model = editor.getModel();
  if (!model) return false;

  const line = change.range.startLineNumber;
  const column = findAmpersandEscape(model.getLineContent(line), change.range.startColumn);
  if (column === null) return false;

  const region = computeLockedRegion(model, "pretext");
  if (region?.lockedLines.includes(line)) return false;

  const offset = model.getOffsetAt({ lineNumber: line, column });
  if (!isXmlTextPosition(model.getValue(), offset)) return false;

  const range = new monaco.Range(line, column, line, column + 1);
  model.pushStackElement();
  editor.executeEdits("ampersand-auto-convert", [
    { range, text: "&amp;", forceMoveMarkers: true },
  ]);
  model.pushStackElement();
  return true;
};
