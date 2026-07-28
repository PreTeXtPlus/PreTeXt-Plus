import { useEffect, useState } from "react";
import { Editor } from "@monaco-editor/react";
import "./dialog.css";

export interface DocinfoEditorCloseValue {
  /** The project-specific docinfo XML from this editor session. */
  docinfo: string;
  /** The user-level common docinfo XML from this editor session. */
  commonDocinfo: string;
  /** Whether the project should use the user's common docinfo. */
  useCommonDocinfo: boolean;
}

export interface DocinfoEditorProps {
  /** The current docinfo XML string (the full `<docinfo>` element or empty). */
  docinfo: string;
  /** Called on Save with docinfo settings, or `undefined` on Cancel. */
  onClose: (value: DocinfoEditorCloseValue | undefined) => void;
  /** Show project-level controls for a user's common docinfo. */
  showCommonDocinfoControls?: boolean;
  /** The user's common docinfo XML available to import. */
  commonDocinfo?: string;
  /** Initial state of the "Use my common docinfo/preamble" checkbox. */
  initialUseCommonDocinfo?: boolean;
}

type DocinfoTab = "macros" | "preamble" | "other";

const latexEditorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  wordWrap: "on" as const,
  lineNumbers: "on" as const,
  scrollBeyondLastLine: false,
  tabSize: 2,
  fontSize: 13,
  padding: { top: 10, bottom: 10 },
};

const xmlEditorOptions = {
  ...latexEditorOptions,
  language: "xml",
};

/** Returns the text content of the named element, or "" if absent. */
const extractTextElement = (doc: Document, tagName: string): string =>
  doc.querySelector(tagName)?.textContent ?? "";

/**
 * Serializes all child elements of `<docinfo>` whose tag names are not in
 * `exclude`, returning them as indented XML lines ready for display.
 */
const extractOtherElements = (doc: Document, exclude: string[]): string => {
  const serializer = new XMLSerializer();
  return Array.from(doc.documentElement.children)
    .filter((el) => !exclude.includes(el.tagName))
    .map((el) => serializer.serializeToString(el))
    .join("\n");
};

/** Parses a docinfo XML string and returns a DOM Document (or an empty docinfo). */
const parseDocinfo = (docinfo: string): Document => {
  if (!docinfo.trim()) {
    return new DOMParser().parseFromString("<docinfo/>", "application/xml");
  }
  return new DOMParser().parseFromString(docinfo, "application/xml");
};

const hasParseError = (doc: Document): boolean =>
  doc.getElementsByTagName("parsererror").length > 0;

const mergeTextField = (current: string, incoming: string): string => {
  const trimmedCurrent = current.trim();
  const trimmedIncoming = incoming.trim();
  if (!trimmedIncoming) return current;
  if (!trimmedCurrent) return trimmedIncoming;
  if (trimmedCurrent.includes(trimmedIncoming)) return current;
  if (trimmedIncoming.includes(trimmedCurrent)) return trimmedIncoming;
  return `${trimmedCurrent}\n${trimmedIncoming}`;
};

const mergeOtherElements = (
  current: string,
  incomingDocinfo: Document,
): string => {
  if (hasParseError(incomingDocinfo)) return current;

  const existingDoc = new DOMParser().parseFromString(
    `<docinfo>${current}</docinfo>`,
    "application/xml",
  );
  if (hasParseError(existingDoc)) {
    // If current "other" content is temporarily invalid, do not overwrite it.
    return current;
  }

  const existingTags = new Set(
    Array.from(existingDoc.documentElement.children).map((el) => el.tagName),
  );
  const serializer = new XMLSerializer();
  const incomingChildren = Array.from(
    incomingDocinfo.documentElement.children,
  ).filter((el) => !["macros", "latex-image-preamble"].includes(el.tagName));

  const additions = incomingChildren
    .filter((el) => !existingTags.has(el.tagName))
    .map((el) => serializer.serializeToString(el));

  if (additions.length === 0) return current;
  const trimmedCurrent = current.trim();
  return trimmedCurrent
    ? `${trimmedCurrent}\n${additions.join("\n")}`
    : additions.join("\n");
};

/**
 * Rebuilds the full `<docinfo>` XML from the three editor regions.
 * Omits elements whose content is blank.
 */
const buildDocinfo = (
  macros: string,
  preamble: string,
  other: string,
): string => {
  const parts: string[] = [];
  if (macros.trim()) parts.push(`  <macros>${macros}</macros>`);
  if (preamble.trim())
    parts.push(`  <latex-image-preamble>${preamble}</latex-image-preamble>`);
  if (other.trim()) {
    for (const line of other.trim().split("\n")) {
      parts.push(`  ${line}`);
    }
  }
  if (parts.length === 0) return "";
  return `<docinfo>\n${parts.join("\n")}\n</docinfo>`;
};

const TAB_LABELS: Record<DocinfoTab, string> = {
  macros: "LaTeX Macros",
  preamble: "Image Macros",
  other: "Other Elements",
};

const TAB_DESCRIPTIONS: Record<DocinfoTab, string> = {
  macros:
    "LaTeX macros available throughout the document. Stored in <macros> inside <docinfo>. Use \\newcommand to define new macros (avoid using \\def).",
  preamble:
    "LaTeX macros for rendering TikZ/LaTeX images. Stored in <latex-image-preamble> inside <docinfo>.",
  other:
    "Any additional <docinfo> child elements (e.g. <cross-references>, <rename>). Edit as raw XML — one element per line.",
};

/**
 * Modal dialog for editing the PreTeXt `<docinfo>` section, with three tabs:
 * Macros, Image Preamble, and Other Elements.
 */
const DocinfoEditor = ({
  docinfo,
  onClose,
  showCommonDocinfoControls = false,
  commonDocinfo = "",
  initialUseCommonDocinfo = false,
}: DocinfoEditorProps) => {
  const [activeTab, setActiveTab] = useState<DocinfoTab>("macros");
  const [useCommonDocinfo, setUseCommonDocinfo] = useState(
    initialUseCommonDocinfo,
  );

  const doc = parseDocinfo(docinfo);
  const [macros, setMacros] = useState(() => extractTextElement(doc, "macros"));
  const [preamble, setPreamble] = useState(() =>
    extractTextElement(doc, "latex-image-preamble"),
  );
  const [other, setOther] = useState(() =>
    extractOtherElements(doc, ["macros", "latex-image-preamble"]),
  );

  const commonDoc = parseDocinfo(commonDocinfo);
  const [commonMacros, setCommonMacros] = useState(() =>
    extractTextElement(commonDoc, "macros"),
  );
  const [commonPreamble, setCommonPreamble] = useState(() =>
    extractTextElement(commonDoc, "latex-image-preamble"),
  );
  const [commonOther, setCommonOther] = useState(() =>
    extractOtherElements(commonDoc, ["macros", "latex-image-preamble"]),
  );

  const canImportCommonDocinfo = commonDocinfo.trim().length > 0;

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose(undefined);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleSave = () => {
    onClose({
      docinfo: buildDocinfo(macros, preamble, other),
      commonDocinfo: buildDocinfo(commonMacros, commonPreamble, commonOther),
      useCommonDocinfo,
    });
  };

  const handleImportCommonDocinfo = () => {
    if (!canImportCommonDocinfo) return;
    const commonDoc = parseDocinfo(commonDocinfo);
    if (hasParseError(commonDoc)) return;
    setMacros((current) =>
      mergeTextField(current, extractTextElement(commonDoc, "macros")),
    );
    setPreamble((current) =>
      mergeTextField(
        current,
        extractTextElement(commonDoc, "latex-image-preamble"),
      ),
    );
    setOther((current) => mergeOtherElements(current, commonDoc));
  };

  const currentValue =
    activeTab === "macros"
      ? useCommonDocinfo
        ? commonMacros
        : macros
      : activeTab === "preamble"
      ? useCommonDocinfo
        ? commonPreamble
        : preamble
      : useCommonDocinfo
      ? commonOther
      : other;
  const currentLanguage = activeTab === "other" ? "xml" : "latex";
  const isEditingCommonDocinfo = showCommonDocinfoControls && useCommonDocinfo;
  const currentSetter =
    activeTab === "macros"
      ? useCommonDocinfo
        ? setCommonMacros
        : setMacros
      : activeTab === "preamble"
      ? useCommonDocinfo
        ? setCommonPreamble
        : setPreamble
      : useCommonDocinfo
      ? setCommonOther
      : setOther;

  return (
    <div
      className="pretext-plus-editor__dialog-overlay"
      onClick={() => onClose(undefined)}
    >
      <div
        className={`pretext-plus-editor__dialog${
          isEditingCommonDocinfo
            ? " pretext-plus-editor__dialog--common-mode"
            : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-editor-docinfo-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pretext-plus-editor__dialog-header">
          <div>
            <h2
              id="pretext-plus-editor-docinfo-dialog-title"
              className="pretext-plus-editor__dialog-title"
            >
              Edit docinfo/preamble elements
            </h2>
            <p className="pretext-plus-editor__dialog-copy">
              {TAB_DESCRIPTIONS[activeTab]}
            </p>
            {showCommonDocinfoControls ? (
              <label className="pretext-plus-editor__dialog-checkbox-row">
                <input
                  type="checkbox"
                  checked={useCommonDocinfo}
                  onChange={(event) =>
                    setUseCommonDocinfo(event.currentTarget.checked)
                  }
                />
                <span>Use my common docinfo/preamble.</span>
              </label>
            ) : null}
            {showCommonDocinfoControls && !useCommonDocinfo ? (
              <div className="pretext-plus-editor__dialog-common-import-row">
                <button
                  type="button"
                  className="pretext-plus-editor__dialog-link-button"
                  onClick={handleImportCommonDocinfo}
                  disabled={!canImportCommonDocinfo}
                >
                  Import common docinfo
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="pretext-plus-editor__dialog-close"
            onClick={() => onClose(undefined)}
            aria-label="Close docinfo editor"
          >
            Close
          </button>
        </div>

        {isEditingCommonDocinfo ? (
          <div className="pretext-plus-editor__dialog-common-mode-banner">
            You are editing your shared common docinfo/preamble. These values
            will apply to all projects that use this option.
          </div>
        ) : null}

        <>
          <div className="pretext-plus-editor__dialog-tab-bar" role="tablist">
            {(["macros", "preamble", "other"] as DocinfoTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className={`pretext-plus-editor__dialog-tab${
                  activeTab === tab
                    ? " pretext-plus-editor__dialog-tab--active"
                    : ""
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="pretext-plus-editor__dialog-content pretext-plus-editor__dialog-content--single">
            <div className="pretext-plus-editor__dialog-section">
              <div className="pretext-plus-editor__dialog-editor">
                <Editor
                  key={`${activeTab}-${
                    useCommonDocinfo ? "common" : "project"
                  }`}
                  options={
                    activeTab === "other"
                      ? xmlEditorOptions
                      : latexEditorOptions
                  }
                  height="100%"
                  language={currentLanguage}
                  value={currentValue}
                  onChange={(value) => currentSetter(value ?? "")}
                />
              </div>
            </div>
          </div>
        </>
        <div className="pretext-plus-editor__dialog-actions">
          <button
            type="button"
            className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
            onClick={() => onClose(undefined)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pretext-plus-editor__dialog-button"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocinfoEditor;
