// Type definitions for @pretextbook/web-editor

import type * as React from "react";

/** The format of the source content being edited. */
export type SourceFormat = "pretext" | "latex";

/** Payload emitted when a user submits feedback from the editor UI. */
export interface FeedbackSubmission {
  /** Location where feedback was submitted (for example, "main-editor"). */
  context: string;
  /** Optional email provided by the user when they want a response. */
  email?: string;
  /** Free-form feedback message. */
  message: string;
  /** Whether `currentSource` was included in this submission. */
  includeCurrentSource: boolean;
  /** Current source content when the user opted in. */
  currentSource?: string;
  /** Project URL associated with this feedback, when available. */
  projectUrl?: string;
  /** Optional source format metadata for routing/debugging. */
  sourceFormat?: SourceFormat;
  /** Optional title metadata for routing/debugging. */
  title?: string;
  /** Client-side timestamp of submission. */
  submittedAt: string;
}

/** Payload emitted when a LaTeX document is converted into a new PreTeXt project copy. */
export interface PretextProjectCopyRequest {
  /** Converted PreTeXt source used to create the new project copy. */
  pretextSource: string;
  /** Title to use for the new project copy. */
  title: string;
  /** Optional link to the source project the copy came from. */
  projectUrl?: string;
}

/**
 * Represents the full content state of the editor at any point in time.
 * When `sourceFormat` is `"pretext"`, `pretextSource` mirrors `source`.
 * When `sourceFormat` is `"latex"`, `pretextSource` holds the converted XML,
 * or `pretextError` holds an error description if conversion failed.
 */
export interface EditorContentState {
  /** The raw source string as typed/loaded by the user. */
  source: string;
  /** The format of `source`. */
  sourceFormat: SourceFormat;
  /** The PreTeXt XML derived from `source` (present when conversion succeeded). */
  pretextSource?: string;
  /** Human-readable error set when conversion fails.  When present, `pretextSource` is undefined. */
  pretextError?: string;
  /** Project-specific docinfo XML. */
  docinfo?: string;
  /** User-level common docinfo/preamble XML. */
  commonDocinfo?: string;
  /** Whether project rendering should use a user-level common docinfo/preamble. */
  useCommonDocinfo?: boolean;
}

/** The value passed to `onContentChange` — identical to `EditorContentState`. */
export type EditorContentChange = EditorContentState;

/** Returned by {@link derivePretextContent}. Exactly one of the two fields will be set. */
export interface DerivedPretextResult {
  /** The converted (or pass-through) PreTeXt XML string. */
  pretextSource?: string;
  /** Human-readable error when conversion fails. */
  pretextError?: string;
}

/**
 * Inspects `source` and returns the most likely {@link SourceFormat}.
 * Returns `"latex"` when LaTeX markers are detected, otherwise `"pretext"`.
 */
export function detectSourceFormat(source: string): SourceFormat;

/**
 * Converts a LaTeX document string to formatted PreTeXt XML.
 * @throws If the underlying conversion library throws.
 */
export function convertLatexToPretext(latexContent: string): string;

/**
 * Derives PreTeXt content from `source`.  For PreTeXt input the
 * content is returned as-is; for other formats conversion is attempted and
 * errors are caught and returned as `pretextError`.
 */
export function derivePretextContent(
  source: string,
  sourceFormat: SourceFormat,
): DerivedPretextResult;

/** Props accepted by the top-level {@link Editors} component. */
export interface editorProps {
  /** The source content string (PreTeXt XML or LaTeX). */
  source: string;
  /** The format of `source`.  Defaults to `"pretext"` when omitted. */
  sourceFormat?: SourceFormat;
  /** Pre-computed PreTeXt XML for `source`; avoids redundant conversion on first render. */
  pretextSource?: string;
  /** The docinfo element for a pretext document. */
  docinfo?: string;
  /** Optional user-level common docinfo/preamble that project docinfo can import. */
  commonDocinfo?: string;
  /** Whether this project should use the user's common docinfo/preamble. */
  useCommonDocinfo?: boolean;
  /** Called when the project-level common docinfo selection changes. */
  onUseCommonDocinfoChange?: (value: boolean) => void;
  /** Called when the user edits common docinfo from the project dialog. */
  onCommonDocinfoChange?: (value: string) => void;
  /**
   * Called whenever the source content changes.
   * @param value - The new source string.
   * @param meta  - Full derived state snapshot at the time of the change.
   */
  onContentChange: (
    value: string | undefined,
    meta?: EditorContentChange,
  ) => void;
  /** Document title shown in the menu bar. */
  title?: string;
  /** Called when the user edits the title field. */
  onTitleChange?: (value: string) => void;
  /** If provided, a Save button is rendered in the menu bar. */
  onSaveButton?: () => void;
  /** Label for the Save button.  Defaults to `"Save"`. */
  saveButtonLabel?: string;
  /** If provided, a Cancel button is rendered in the menu bar. */
  onCancelButton?: () => void;
  /** Label for the Cancel button.  Defaults to `"Cancel"`. */
  cancelButtonLabel?: string;
  /** Called when a user submits feedback from any built-in feedback link. */
  onFeedbackSubmit?: (feedback: FeedbackSubmission) => void | Promise<void>;
  /** Optional URL for the current project, included in feedback submissions. */
  projectUrl?: string;
  /** Called when user confirms creating a new PreTeXt copy from a LaTeX project. */
  onCreatePretextProjectCopy?: (
    request: PretextProjectCopyRequest,
  ) => void | Promise<void>;
  /** Called on Ctrl+S (in addition to `onSaveButton`). */
  onSave?: () => void;
  /**
   * If provided, the preview panel shows a full iframe preview and
   * Ctrl+Enter / rebuild controls become active.
   */
  onPreviewRebuild?: (
    source: string,
    title: string,
    postToIframe: (url: string, data: any) => void,
  ) => void;
}

export function Editors(props: editorProps): React.JSX.Element;

export function CodeEditor(props: any): React.JSX.Element;

export function VisualEditor(props: any): React.JSX.Element;

export function LivePreview(props: any): React.JSX.Element;

export function FeedbackLink(props: any): React.JSX.Element;

export interface DocinfoEditorCloseValue {
  docinfo: string;
  commonDocinfo: string;
  useCommonDocinfo: boolean;
}

export interface DocinfoEditorProps {
  docinfo: string;
  onClose: (value: DocinfoEditorCloseValue | undefined) => void;
  showCommonDocinfoControls?: boolean;
  commonDocinfo?: string;
  initialUseCommonDocinfo?: boolean;
}

export function DocinfoEditor(props: DocinfoEditorProps): React.JSX.Element;
