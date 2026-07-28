import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Editor } from "@monaco-editor/react";
import {
  convertLatexToPretext,
  getConversionErrorMessage,
} from "../contentConversion";
import StoreFeedbackLink from "./StoreFeedbackLink";
import "./dialog.css";

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
      setConvertedOutput(convertLatexToPretext(trimmedLatex));
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
    <div className="pretext-plus-editor__dialog-overlay" onClick={onClose}>
      <div
        className="pretext-plus-editor__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-editor-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pretext-plus-editor__dialog-header">
          <div>
            <h2
              id="pretext-plus-editor-dialog-title"
              className="pretext-plus-editor__dialog-title"
            >
              Convert LaTeX
            </h2>
            <p className="pretext-plus-editor__dialog-copy">
              Paste LaTeX, convert it to PreTeXt, then copy the result.
            </p>
            <div className="pretext-plus-editor__dialog-feedback-row">
              <StoreFeedbackLink
                label="Give feedback on conversion"
                context="latex-conversion"
              />
            </div>
          </div>
          <button
            type="button"
            className="pretext-plus-editor__dialog-close"
            onClick={onClose}
            aria-label="Close LaTeX import dialog"
          >
            Close
          </button>
        </div>

        <div className="pretext-plus-editor__dialog-content">
          <div className="pretext-plus-editor__dialog-section">
            <div className="pretext-plus-editor__dialog-label-row">
              <label className="pretext-plus-editor__dialog-label">
                LaTeX Input
              </label>
              <button
                type="button"
                className="pretext-plus-editor__dialog-link-button"
                onClick={() => fileInputRef.current?.click()}
              >
                Open .tex File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".tex,text/x-tex"
                className="pretext-plus-editor__dialog-file-input"
                onChange={handleFileInputChange}
              />
            </div>
            <div
              className={`pretext-plus-editor__dialog-editor ${
                isDragActive ? "pretext-plus-editor__dialog-editor--drag" : ""
              }`}
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
            </div>
            <p className="pretext-plus-editor__dialog-helper-copy">
              Paste LaTeX, open a `.tex` file, or drag one onto this editor.
            </p>
          </div>

          <div className="pretext-plus-editor__dialog-section">
            <div className="pretext-plus-editor__dialog-label-row">
              <label className="pretext-plus-editor__dialog-label">
                Converted PreTeXt
              </label>
              {copyStatus === "copied" ? (
                <span className="pretext-plus-editor__dialog-status">
                  Copied
                </span>
              ) : null}
            </div>
            <div className="pretext-plus-editor__dialog-editor">
              <Editor
                options={{ ...editorOptions, readOnly: true }}
                height="100%"
                language="xml"
                value={convertedOutput}
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
            className="pretext-plus-editor__dialog-button"
            onClick={handleConvert}
            disabled={!latexInput.trim()}
          >
            Convert
          </button>
          <button
            type="button"
            className="pretext-plus-editor__dialog-button"
            onClick={handleCopy}
            disabled={!convertedOutput}
          >
            Copy and Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LatexImportDialog;
