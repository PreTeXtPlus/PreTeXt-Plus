import { useEffect } from "react";
import { Editor } from "@monaco-editor/react";
import type { SourceFormat } from "../types/editor";
import "./dialog.css";

interface ConvertToPretextDialogProps {
  /** The current source to display (read-only) on the left. */
  source: string;
  /** The format of `source` — used for the left-panel label and Monaco language. */
  sourceFormat: SourceFormat;
  /** The already-converted PreTeXt to display (read-only) on the right. */
  pretextSource: string;
  /** Called when the user confirms creating a converted PreTeXt division. */
  onConfirm: () => void;
  /** Called when the dialog should close without converting. */
  onClose: () => void;
}

const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  wordWrap: "on" as const,
  readOnly: true,
  scrollBeyondLastLine: false,
  tabSize: 2,
  fontSize: 13,
  padding: { top: 10, bottom: 10 },
};

const FORMAT_LABELS: Record<SourceFormat, string> = {
  latex: "LaTeX",
  markdown: "Markdown",
  pretext: "PreTeXt",
};

const FORMAT_LANGUAGES: Record<SourceFormat, string> = {
  latex: "latex",
  markdown: "markdown",
  pretext: "xml",
};

/**
 * Confirmation dialog shown before converting a non-PreTeXt division into a
 * new PreTeXt division. Displays both sources side-by-side for review.
 */
const ConvertToPretextDialog = ({
  source,
  sourceFormat,
  pretextSource,
  onConfirm,
  onClose,
}: ConvertToPretextDialogProps) => {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const sourceLabel = FORMAT_LABELS[sourceFormat] ?? sourceFormat;

  return (
    <div className="pretext-plus-editor__dialog-overlay" onClick={onClose}>
      <div
        className="pretext-plus-editor__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-editor-convert-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pretext-plus-editor__dialog-header">
          <div>
            <h2
              id="pretext-plus-editor-convert-dialog-title"
              className="pretext-plus-editor__dialog-title"
            >
              Convert Division to PreTeXt
            </h2>
            <p className="pretext-plus-editor__dialog-copy">
              Add a new PreTeXt division using the converted source below. Your
              current {sourceLabel} division will remain unchanged.
            </p>
          </div>
          <button
            type="button"
            className="pretext-plus-editor__dialog-close"
            onClick={onClose}
            aria-label="Close convert to PreTeXt dialog"
          >
            Close
          </button>
        </div>

        <div className="pretext-plus-editor__dialog-content">
          <div className="pretext-plus-editor__dialog-section">
            <div className="pretext-plus-editor__dialog-label-row">
              <label className="pretext-plus-editor__dialog-label">
                Current {sourceLabel} Source
              </label>
            </div>
            <div className="pretext-plus-editor__dialog-editor">
              <Editor
                options={editorOptions}
                height="100%"
                language={FORMAT_LANGUAGES[sourceFormat] ?? "plaintext"}
                value={source}
              />
            </div>
          </div>

          <div className="pretext-plus-editor__dialog-section">
            <div className="pretext-plus-editor__dialog-label-row">
              <label className="pretext-plus-editor__dialog-label">
                Converted PreTeXt
              </label>
            </div>
            <div className="pretext-plus-editor__dialog-editor">
              <Editor
                options={editorOptions}
                height="100%"
                language="xml"
                value={pretextSource}
              />
            </div>
          </div>
        </div>

        <div className="pretext-plus-editor__dialog-actions">
          <button
            type="button"
            className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--danger"
            onClick={handleConfirm}
          >
            Create PreTeXt Division
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConvertToPretextDialog;
