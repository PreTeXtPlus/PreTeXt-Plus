import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Editor } from "@monaco-editor/react";
import {
  cleanLatexSource,
  convertLatexToPretext,
  getConversionErrorMessage,
} from "../contentConversion";
import CleanFindingsList from "./CleanFindingsList";
import type { CleanFinding } from "../cleanFindings";
import StoreFeedbackLink from "./StoreFeedbackLink";
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
  DialogLinkButton,
  DialogFileInput,
  DialogEditorPane,
  DialogHelperCopy,
  DialogStatus,
  DialogActions,
  DialogButton,
  DialogCheckboxRow,
} from "./Dialog";

interface LatexImportDialogProps {
  /** Called when the dialog should close (Cancel button, Escape key, or after "Copy and Close"). */
  onClose: () => void;
}

/**
 * Modal dialog that lets the user paste, open, or drag-and-drop a `.tex` file,
 * convert it to PreTeXt, and copy the result to the clipboard.
 *
 * The dialog does not modify the editor content directly; it relies on the
 * user copying the output and pasting it wherever needed.
 */
const LatexImportDialog = ({
  onClose,
}: LatexImportDialogProps) => {
  const [latexInput, setLatexInput] = useState("");
  const [convertedOutput, setConvertedOutput] = useState("");
  // On by default: pasted LaTeX is nearly always lifted out of a document
  // written for print, and its presentational markup has no meaning in PreTeXt.
  // Exposed as a checkbox rather than done silently so the author can see that
  // their input was rewritten, and turn it off when they want a literal
  // conversion.
  const [cleanBeforeConvert, setCleanBeforeConvert] = useState(true);
  const [cleanFindings, setCleanFindings] = useState<CleanFinding[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const inputEditorRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorOptions = {
    automaticLayout: true,
    minimap: { enabled: false },
    wordWrap: "on" as const,
    lineNumbers: "on" as const,
    scrollBeyondLastLine: false,
    tabSize: 2,
    fontSize: 13,
    padding: { top: 10, bottom: 10 },
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    inputEditorRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleConvert = () => {
    const trimmedLatex = latexInput.trim();
    if (!trimmedLatex) {
      return;
    }

    try {
      const cleaned = cleanBeforeConvert
        ? cleanLatexSource(trimmedLatex)
        : { latex: trimmedLatex, findings: [] };
      setCleanFindings(cleaned.findings);
      setConvertedOutput(convertLatexToPretext(cleaned.latex));
      setCopyStatus("idle");
    } catch (error) {
      console.error("Error converting LaTeX:", error);
      alert(getConversionErrorMessage(error));
    }
  };

  const handleCopy = async () => {
    if (!convertedOutput) {
      return;
    }

    try {
      await navigator.clipboard.writeText(convertedOutput);
      setCopyStatus("copied");
      onClose();
    } catch (error) {
      console.error("Error copying converted PreTeXt:", error);
      setCopyStatus("error");
      alert("Could not copy to clipboard");
    }
  };

  /**
   * Reads a `.tex` file selected via the file picker or drag-and-drop,
   * loads its text into the LaTeX input editor, and resets conversion output.
   *
   * @param file - The File object to read.
   */
  const readLatexFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".tex")) {
      alert("Please choose a .tex file");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setLatexInput(text);
      setConvertedOutput("");
      setCleanFindings([]);
      setCopyStatus("idle");
      inputEditorRef.current?.focus();
    };
    reader.onerror = () => {
      alert("Could not read file");
    };
    reader.readAsText(file);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      readLatexFile(file);
    }
    // Allow selecting the same file again later.
    event.target.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      readLatexFile(file);
    }
  };

  return (
    <DialogOverlay onClick={onClose}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-editor-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <div>
            <DialogTitle id="pretext-plus-editor-dialog-title">
              Convert LaTeX
            </DialogTitle>
            <DialogCopy>
              Paste LaTeX, convert it to PreTeXt, then copy the result.
            </DialogCopy>
            <div className="mt-[0.45rem]">
              <StoreFeedbackLink
                label="Give feedback on conversion"
                context="latex-conversion"
              />
            </div>
          </div>
          <DialogClose onClick={onClose} aria-label="Close LaTeX import dialog">
            Close
          </DialogClose>
        </DialogHeader>

        <DialogContent>
          <DialogSection>
            <DialogLabelRow>
              <DialogLabel>LaTeX Input</DialogLabel>
              <DialogLinkButton onClick={() => fileInputRef.current?.click()}>
                Open .tex File
              </DialogLinkButton>
              <DialogFileInput
                ref={fileInputRef}
                accept=".tex,text/x-tex"
                onChange={handleFileInputChange}
              />
            </DialogLabelRow>
            <DialogEditorPane
              dragActive={isDragActive}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Editor
                options={editorOptions}
                height="100%"
                language="latex"
                value={latexInput}
                onMount={(editor) => {
                  inputEditorRef.current = editor;
                  editor.focus();
                }}
                onChange={(value) => setLatexInput(value || "")}
              />
            </DialogEditorPane>
            <DialogHelperCopy as="p">
              Paste LaTeX, open a `.tex` file, or drag one onto this editor.
            </DialogHelperCopy>
            <DialogCheckboxRow className="mt-1">
              <input
                type="checkbox"
                checked={cleanBeforeConvert}
                onChange={(event) =>
                  setCleanBeforeConvert(event.target.checked)
                }
              />
              Clean up LaTeX before converting
            </DialogCheckboxRow>
          </DialogSection>

          <DialogSection>
            <DialogLabelRow>
              <DialogLabel>Converted PreTeXt</DialogLabel>
              {copyStatus === "copied" ? <DialogStatus>Copied</DialogStatus> : null}
            </DialogLabelRow>
            <DialogEditorPane>
              <Editor
                options={{ ...editorOptions, readOnly: true }}
                height="100%"
                language="xml"
                value={convertedOutput}
              />
            </DialogEditorPane>
            {cleanFindings.length > 0 && (
              <div className="shrink-0 max-h-[35%] overflow-y-auto">
                <DialogLabel className="block mb-1.5">
                  Cleaned before converting
                </DialogLabel>
                <CleanFindingsList findings={cleanFindings} />
              </div>
            )}
          </DialogSection>
        </DialogContent>

        <DialogActions>
          <DialogButton variant="secondary" onClick={onClose}>
            Cancel
          </DialogButton>
          <DialogButton onClick={handleConvert} disabled={!latexInput.trim()}>
            Convert
          </DialogButton>
          <DialogButton onClick={handleCopy} disabled={!convertedOutput}>
            Copy and Close
          </DialogButton>
        </DialogActions>
      </Dialog>
    </DialogOverlay>
  );
};

export default LatexImportDialog;
