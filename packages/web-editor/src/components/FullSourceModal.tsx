import { useEffect } from "react";
import { Editor } from "@monaco-editor/react";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogCopy,
  DialogClose,
  DialogContent,
  DialogSection,
  DialogEditorPane,
  DialogActions,
  DialogButton,
} from "./Dialog";

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
    <DialogOverlay onClick={onClose}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-editor-full-source-title"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <div>
            <DialogTitle id="pretext-plus-editor-full-source-title">
              Full Document Source
            </DialogTitle>
            <DialogCopy>
              The complete assembled PreTeXt source for this project, with every
              division and asset reference expanded. This view is read-only.
            </DialogCopy>
          </div>
          <DialogClose
            onClick={onClose}
            aria-label="Close full document source dialog"
          >
            Close
          </DialogClose>
        </DialogHeader>

        <DialogContent single>
          <DialogSection>
            <DialogEditorPane>
              <Editor
                options={editorOptions}
                height="100%"
                language="xml"
                value={source}
              />
            </DialogEditorPane>
          </DialogSection>
        </DialogContent>

        <DialogActions>
          <DialogButton variant="secondary" onClick={handleCopy}>
            Copy to Clipboard
          </DialogButton>
          <DialogButton onClick={onClose}>Done</DialogButton>
        </DialogActions>
      </Dialog>
    </DialogOverlay>
  );
};

export default FullSourceModal;
