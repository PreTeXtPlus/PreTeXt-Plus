/**
 * Tools → Import…: convert outside material to PreTeXt for the division being
 * edited, and hand it back to copy.
 *
 * The left pane holds the source when there is text worth showing — typed,
 * pasted, or read from a `.tex`, `.md` or `.ptx` file — so the author can trim
 * it before converting. LaTeX and Markdown there go through this package's own
 * converters unless the author opts into the host's alternative (pandoc, where
 * it is wired). Any other file (Word, EPUB, an archive of LaTeX) goes whole to
 * the host's converters, and the left pane shows only its name. The
 * right pane holds the result, fitted to the division it is headed for (see
 * `importConvert.ts`) and editable before it is copied.
 *
 * Nothing here writes to the project. The author pastes the result where it
 * belongs, so it reaches the undo history, the collaborative doc and the host
 * exactly as any other paste does.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Editor } from "@monaco-editor/react";
import type { ImportEngine } from "@pretextbook/import/react";
import {
  acceptedImportExtensions,
  alternateTextEngine,
  convertImportFile,
  convertImportText,
  convertImportTextWithEngine,
  detectImportFormat,
  fitImportForDivision,
  resolveImportEngines,
  routeImportFile,
} from "../importConvert";
import type { CleanFinding } from "../cleanFindings";
import type { SourceFormat } from "../types/editor";
import type { DivisionType } from "../types/sections";
import CleanFindingsList from "./CleanFindingsList";
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

interface ImportDialogProps {
  /**
   * Converters for files that are not plain text, in precedence order.
   * Defaults to `@pretextbook/import`'s built-in one.
   */
  engines?: ImportEngine[];
  /** Type of the division the result is for; imported divisions are fitted inside it. */
  parentType?: DivisionType | null;
  /** Every id the project already uses, so imported ones can be renamed away from them. */
  takenIds: readonly string[];
  /** Called when the dialog should close (Cancel, Escape, or after "Copy and Close"). */
  onClose: () => void;
}

const FORMAT_LABELS: Record<SourceFormat, string> = {
  latex: "LaTeX",
  markdown: "Markdown",
  pretext: "PreTeXt",
};

/**
 * What the author can tell the dialog the source is. Detection is right for
 * whole documents and for LaTeX, but a short Markdown snippet can read as
 * something else: ties go to LaTeX, so `Let $x$ be *prime*.` is taken for TeX,
 * and a pipe table scores as neither. PreTeXt is never a choice — it is what
 * detection says when there is nothing to convert.
 */
type FormatChoice = "auto" | "latex" | "markdown";

const MONACO_LANGUAGES: Record<SourceFormat, string> = {
  latex: "latex",
  markdown: "markdown",
  pretext: "xml",
};

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

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Could not convert this to PreTeXt.";

const ImportDialog = ({
  engines,
  parentType,
  takenIds,
  onClose,
}: ImportDialogProps) => {
  const engineList = useMemo(() => resolveImportEngines(engines), [engines]);
  const accept = useMemo(
    () => acceptedImportExtensions(engineList).join(","),
    [engineList],
  );

  const [sourceText, setSourceText] = useState("");
  const [formatChoice, setFormatChoice] = useState<FormatChoice>("auto");
  /** A file converted whole by an engine; while set, there is no source text. */
  const [file, setFile] = useState<File | null>(null);
  // On by default: pasted LaTeX is nearly always lifted out of a document
  // written for print, and its presentational markup has no meaning in PreTeXt.
  // A checkbox rather than silent, so the author can see their input was
  // rewritten and turn it off for a literal conversion.
  const [cleanBeforeConvert, setCleanBeforeConvert] = useState(true);
  // Off by default: the local converters are instant and the ones every
  // LaTeX and Markdown division already uses. The alternative is a round trip
  // to a server, worth it when the local result dropped something.
  const [useAlternate, setUseAlternate] = useState(false);
  const [output, setOutput] = useState("");
  const [findings, setFindings] = useState<CleanFinding[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  // Bumped by every conversion, so a slow one (a remote engine can take tens
  // of seconds) cannot land on top of a newer one or a different source.
  const requestRef = useRef(0);
  const inputEditorRef = useRef<{ focus: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const detectedFormat = useMemo(
    () => detectImportFormat(sourceText),
    [sourceText],
  );
  const format = formatChoice === "auto" ? detectedFormat : formatChoice;
  const alternate = useMemo(
    () => alternateTextEngine(format, engineList),
    [format, engineList],
  );

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const clearResult = () => {
    requestRef.current += 1;
    setOutput("");
    setFindings([]);
    setNotes([]);
    setError(null);
    setCopyStatus("idle");
    setIsConverting(false);
  };

  const convert = async (source: File | null = file) => {
    const request = ++requestRef.current;
    setIsConverting(true);
    setError(null);
    setCopyStatus("idle");
    try {
      const options = { clean: cleanBeforeConvert };
      const converted = source
        ? await convertImportFile(source, engineList)
        : alternate && useAlternate
          ? await convertImportTextWithEngine(sourceText, format, alternate, options)
          : convertImportText(sourceText, format, options);
      if (request !== requestRef.current) return;
      const fitted = fitImportForDivision(converted.pretext, {
        parentType,
        takenIds,
      });
      setOutput(fitted.source);
      setFindings(converted.findings);
      setNotes([...converted.notes, ...fitted.notes]);
      if (!fitted.source) setError("The conversion came back empty.");
    } catch (caught) {
      if (request !== requestRef.current) return;
      console.error("Error converting import:", caught);
      setOutput("");
      setFindings([]);
      setNotes([]);
      setError(errorMessage(caught));
    } finally {
      if (request === requestRef.current) setIsConverting(false);
    }
  };

  const handleCopy = async () => {
    if (!output.trim()) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopyStatus("copied");
      onClose();
    } catch (caught) {
      console.error("Error copying converted PreTeXt:", caught);
      setCopyStatus("error");
      alert("Could not copy to clipboard");
    }
  };

  /**
   * Take a file from the picker or a drop. Text formats load into the source
   * pane and wait for Convert, like anything typed there; any other file
   * converts straight away, since there is nothing to edit first.
   */
  const openFile = (picked: File) => {
    const route = routeImportFile(picked.name, engineList);
    if (route.kind === "unsupported") {
      alert(route.message);
      return;
    }
    clearResult();
    if (route.kind === "engine") {
      setFile(picked);
      void convert(picked);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setFile(null);
      setSourceText(typeof reader.result === "string" ? reader.result : "");
      // A PreTeXt file opens with markup, which detection already reads as
      // PreTeXt; the extension only needs to settle LaTeX against Markdown.
      setFormatChoice(route.format === "pretext" ? "auto" : route.format);
      inputEditorRef.current?.focus();
    };
    reader.onerror = () => alert("Could not read file");
    reader.readAsText(picked);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (picked) openFile(picked);
    // Allow choosing the same file again later.
    event.target.value = "";
  };

  const dropHandlers = {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDragActive(true);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) openFile(dropped);
    },
  };

  const canConvert = !isConverting && (file !== null || sourceText.trim() !== "");

  return (
    <DialogOverlay onClick={onClose}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-import-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <div>
            <DialogTitle id="pretext-plus-import-dialog-title">Import</DialogTitle>
            <DialogCopy>
              Convert LaTeX, Markdown or another document to PreTeXt that fits
              this division, then copy the result.
            </DialogCopy>
            <div className="mt-[0.45rem]">
              <StoreFeedbackLink
                label="Give feedback on conversion"
                context="latex-conversion"
              />
            </div>
          </div>
          <DialogClose onClick={onClose} aria-label="Close import dialog">
            Close
          </DialogClose>
        </DialogHeader>

        <DialogContent>
          <DialogSection>
            <DialogLabelRow className="gap-3">
              <DialogLabel>Source</DialogLabel>
              <span className="flex items-center gap-3">
                {file ? null : (
                  <select
                    aria-label="Source format"
                    className="text-[0.8rem] text-slate-700 bg-white border border-slate-300 rounded-[2px] py-0.5 px-1"
                    value={formatChoice}
                    onChange={(event) =>
                      setFormatChoice(event.target.value as FormatChoice)
                    }
                  >
                    <option value="auto">
                      Auto-detect
                    </option>
                    <option value="latex">LaTeX</option>
                    <option value="markdown">Markdown</option>
                  </select>
                )}
                <DialogLinkButton onClick={() => fileInputRef.current?.click()}>
                  Open File…
                </DialogLinkButton>
              </span>
              <DialogFileInput
                ref={fileInputRef}
                accept={accept}
                onChange={handleFileInputChange}
                data-testid="import-file-input"
              />
            </DialogLabelRow>
            {file ? (
              <DialogEditorPane
                dragActive={isDragActive}
                className="flex flex-col items-center justify-center gap-2 p-6 text-center"
                data-testid="import-file-source"
                {...dropHandlers}
              >
                <p className="m-0 font-semibold text-slate-800 break-all">
                  {file.name}
                </p>
                <DialogHelperCopy as="p">
                  Converted from the file directly — there is no source to show.
                </DialogHelperCopy>
                <DialogLinkButton
                  onClick={() => {
                    setFile(null);
                    clearResult();
                  }}
                >
                  Paste text instead
                </DialogLinkButton>
              </DialogEditorPane>
            ) : (
              <DialogEditorPane
                dragActive={isDragActive}
                data-testid="import-source"
                {...dropHandlers}
              >
                <Editor
                  options={editorOptions}
                  height="100%"
                  language={MONACO_LANGUAGES[format]}
                  value={sourceText}
                  onMount={(editor) => {
                    inputEditorRef.current = editor;
                    editor.focus();
                  }}
                  onChange={(value) => setSourceText(value || "")}
                />
              </DialogEditorPane>
            )}
            {file ? null : (
              <>
                <DialogHelperCopy as="p">
                  Paste LaTeX or Markdown, open a file, or drag one onto this
                  editor.
                </DialogHelperCopy>
                {format === "latex" && (
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
                )}
                {alternate && (
                  <DialogCheckboxRow className="mt-1" title={alternate.description}>
                    <input
                      type="checkbox"
                      checked={useAlternate}
                      onChange={(event) => setUseAlternate(event.target.checked)}
                    />
                    Convert with {alternate.label} instead
                  </DialogCheckboxRow>
                )}
              </>
            )}
          </DialogSection>

          <DialogSection>
            <DialogLabelRow>
              <DialogLabel>Converted PreTeXt</DialogLabel>
              {isConverting ? (
                <DialogStatus>Converting…</DialogStatus>
              ) : copyStatus === "copied" ? (
                <DialogStatus>Copied</DialogStatus>
              ) : null}
            </DialogLabelRow>
            <DialogEditorPane data-testid="import-output">
              <Editor
                options={editorOptions}
                height="100%"
                language="xml"
                value={output}
                onChange={(value) => {
                  setOutput(value || "");
                  setCopyStatus("idle");
                }}
              />
            </DialogEditorPane>
            {error && (
              <p role="alert" className="m-0 text-red-700 text-[0.85rem]">
                {error}
              </p>
            )}
            {(notes.length > 0 || findings.length > 0) && (
              <div className="shrink-0 max-h-[35%] overflow-y-auto flex flex-col gap-2">
                {notes.length > 0 && (
                  <ul
                    className="m-0 pl-5 list-disc text-slate-700 text-[0.85rem]"
                    data-testid="import-notes"
                  >
                    {notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                )}
                {findings.length > 0 && (
                  <div>
                    <DialogLabel className="block mb-1.5">
                      Cleaned before converting
                    </DialogLabel>
                    <CleanFindingsList findings={findings} />
                  </div>
                )}
              </div>
            )}
          </DialogSection>
        </DialogContent>

        <DialogActions>
          <DialogButton variant="secondary" onClick={onClose}>
            Cancel
          </DialogButton>
          <DialogButton onClick={() => void convert()} disabled={!canConvert}>
            Convert
          </DialogButton>
          <DialogButton
            onClick={handleCopy}
            disabled={isConverting || !output.trim()}
          >
            Copy and Close
          </DialogButton>
        </DialogActions>
      </Dialog>
    </DialogOverlay>
  );
};

export default ImportDialog;
