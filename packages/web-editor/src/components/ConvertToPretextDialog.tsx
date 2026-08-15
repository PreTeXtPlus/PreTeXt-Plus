import { useEffect } from "react";
import { Editor } from "@monaco-editor/react";
import type { SourceFormat } from "../types/editor";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogCopy,
  DialogClose,
  DialogContent,
  DialogSection,
  DialogLabelRow,
  DialogLabel,
  DialogEditorPane,
  DialogActions,
  DialogButton,
} from "./Dialog";

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
    <DialogOverlay onClick={onClose}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-editor-convert-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <div>
            <DialogTitle id="pretext-plus-editor-convert-dialog-title">
              Convert Division to PreTeXt
            </DialogTitle>
            <DialogCopy>
              Add a new PreTeXt division using the converted source below. Your
              current {sourceLabel} division will remain unchanged.
            </DialogCopy>
          </div>
          <DialogClose onClick={onClose} aria-label="Close convert to PreTeXt dialog">
            Close
          </DialogClose>
        </DialogHeader>

        <DialogContent>
          <DialogSection>
            <DialogLabelRow>
              <DialogLabel>Current {sourceLabel} Source</DialogLabel>
            </DialogLabelRow>
            <DialogEditorPane>
              <Editor
                options={editorOptions}
                height="100%"
                language={FORMAT_LANGUAGES[sourceFormat] ?? "plaintext"}
                value={source}
              />
            </DialogEditorPane>
          </DialogSection>

          <DialogSection>
            <DialogLabelRow>
              <DialogLabel>Converted PreTeXt</DialogLabel>
            </DialogLabelRow>
            <DialogEditorPane>
              <Editor
                options={editorOptions}
                height="100%"
                language="xml"
                value={pretextSource}
              />
            </DialogEditorPane>
          </DialogSection>
        </DialogContent>

        <DialogActions>
          <DialogButton variant="secondary" onClick={onClose}>
            Cancel
          </DialogButton>
          <DialogButton variant="danger" onClick={handleConfirm}>
            Create PreTeXt Division
          </DialogButton>
        </DialogActions>
      </Dialog>
    </DialogOverlay>
  );
};

export default ConvertToPretextDialog;
