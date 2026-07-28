/**
 * Minimal ambient typings for `constrained-editor-plugin`, which ships no types.
 *
 * Only the subset of the API this project uses is declared. At runtime the
 * plugin also augments the Monaco text model with `disposeRestrictions()` and
 * `updateRestrictions()`, but our editor/model refs are loosely typed (`any`),
 * so those augmentations don't need to appear here.
 */
declare module "constrained-editor-plugin" {
  /** A single editable region: `[startLine, startCol, endLine, endCol]`. */
  export interface RangeRestriction {
    range: [number, number, number, number];
    allowMultiline?: boolean;
    label?: string;
  }

  export interface ConstrainedEditorApi {
    /** Wire the constrainer into a Monaco editor instance (call once). */
    initializeIn(editor: unknown): boolean;
    /** Make only the given ranges editable; everything else becomes read-only. */
    addRestrictionsTo(model: unknown, ranges: RangeRestriction[]): unknown;
    removeRestrictionsIn(model: unknown): boolean;
    disposeConstrainer(): boolean;
    toggleDevMode(): void;
  }

  /** Create a constrainer bound to the given Monaco namespace. */
  export function constrainedEditor(monaco: unknown): ConstrainedEditorApi;
  export default constrainedEditor;
}
