import { useEffect } from "react";
import { Editor } from "@monaco-editor/react";
import "./dialog.css";

interface FullSourceModalProps {
  /** The full, assembled PreTeXt source for the whole project (read-only). */
  source: string;
  /** Called when the dialog should close. */
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

/**
 * Read-only modal that shows the full assembled PreTeXt document for the
 * project — every division resolved and `<plus:* ref="..."/>` placeholder
 * expanded, wrapped in the outer `<pretext>`/`<docinfo>` shell. This is the
 * same shape a host would persist or send to the build server.
 */
const FullSourceModal = ({ source, onClose }: FullSourceModalProps) => {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard?.writeText(source).catch(() => {
      /* clipboard unavailable — nothing actionable to do */
    });
  };

  return (
    <div className="pretext-plus-editor__dialog-overlay" onClick={onClose}>
      <div
        className="pretext-plus-editor__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-editor-full-source-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pretext-plus-editor__dialog-header">
          <div>
            <h2
              id="pretext-plus-editor-full-source-title"
              className="pretext-plus-editor__dialog-title"
            >
              Full Document Source
            </h2>
            <p className="pretext-plus-editor__dialog-copy">
              The complete assembled PreTeXt source for this project, with every
              division and asset reference expanded. This view is read-only.
            </p>
          </div>
          <button
            type="button"
            className="pretext-plus-editor__dialog-close"
            onClick={onClose}
            aria-label="Close full document source dialog"
          >
            Close
          </button>
        </div>

        <div className="pretext-plus-editor__dialog-content pretext-plus-editor__dialog-content--single">
          <div className="pretext-plus-editor__dialog-section">
            <div className="pretext-plus-editor__dialog-editor">
              <Editor
                options={editorOptions}
                height="100%"
                language="xml"
                value={source}
              />
            </div>
          </div>
        </div>

        <div className="pretext-plus-editor__dialog-actions">
          <button
            type="button"
            className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
            onClick={handleCopy}
          >
            Copy to Clipboard
          </button>
          <button
            type="button"
            className="pretext-plus-editor__dialog-button"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default FullSourceModal;
