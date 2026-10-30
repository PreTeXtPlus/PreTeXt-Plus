import { formatPretext } from "@pretextbook/format";
import type { EditorLanguage, SourceFormat } from "../types/editor";
import type { MenuEntry } from "./MenuDropdown";

/**
 * The docinfo editor is named for what the project's format keeps in it — the
 * project's, not the open buffer's: it edits the one `<docinfo>` whatever is
 * open, so its name must not change between a division and a TikZ asset.
 */
const docinfoNaming = (
  docinfoFormat: SourceFormat,
): { label: string; title: string } =>
  docinfoFormat === "latex"
    ? {
        label: "Edit Preamble…",
        title: "Edit the LaTeX preamble shared by the whole project",
      }
    : {
        label: "Edit Macros…",
        title: "Edit the math macros shared by the whole project",
      };

export interface DocumentActionEntriesArgs {
  /** Current source content; passed to the formatter for "Format PreTeXt". */
  content: string;
  /** What the open buffer is written in; decides the actions that act on it. */
  sourceFormat: EditorLanguage;
  /**
   * The project's format (its root division's), which names the docinfo
   * editor. Defaults to the buffer's, for a buffer that is a document.
   */
  docinfoFormat?: SourceFormat;
  readOnly?: boolean;
  /** Called with the formatted content after a successful format operation. */
  onContentChange: (newContent: string) => void;
  onOpenImport?: () => void;
  onOpenClean?: () => void;
  onOpenDocinfoEditor: () => void;
  onOpenAssets?: () => void;
  hideAssets?: boolean;
  onOpenSnippets?: () => void;
  hideSnippets?: boolean;
  onShowFullSource: () => void;
}

/**
 * The document-level actions — Format PreTeXt, Import, Clean up LaTeX, Edit
 * Macros/Preamble, Assets, Snippets, Display Full Source — as opposed to the
 * generic Monaco commands (Go to Line, Toggle Comment, …). Shared between
 * `CodeEditorMenu`'s Tools menu and `TopBar`'s File menu so the two can never
 * drift apart.
 */
export function buildDocumentActionEntries({
  content,
  sourceFormat,
  docinfoFormat = sourceFormat === "tex" ? "pretext" : sourceFormat,
  readOnly,
  onContentChange,
  onOpenImport,
  onOpenClean,
  onOpenDocinfoEditor,
  onOpenAssets,
  hideAssets,
  onOpenSnippets,
  hideSnippets,
  onShowFullSource,
}: DocumentActionEntriesArgs): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (!readOnly) {
    if (sourceFormat === "pretext") {
      entries.push({
        kind: "item",
        key: "format",
        label: "Format PreTeXt",
        title: "Re-indent the PreTeXt source",
        onSelect: () => {
          try {
            onContentChange(formatPretext(content));
          } catch (error) {
            console.error("Error formatting:", error);
            alert("Error formatting XML");
          }
        },
      });
      // Import fits its result to a division (retargeting its sections one rung
      // below it), so it is only offered while one is open.
      if (onOpenImport) {
        entries.push({
          kind: "item",
          key: "import",
          label: "Import…",
          title:
            "Convert LaTeX, Markdown or another document to PreTeXt for this division",
          onSelect: onOpenImport,
        });
      }
    }
    if (onOpenClean) {
      entries.push({
        kind: "item",
        key: "clean",
        label: "Clean up LaTeX…",
        title: "Review LaTeX markup that does not belong in PreTeXt, and fix it",
        onSelect: onOpenClean,
      });
    }
    entries.push({
      kind: "item",
      key: "docinfo",
      ...docinfoNaming(docinfoFormat),
      onSelect: onOpenDocinfoEditor,
    });
    if (onOpenAssets && !hideAssets) {
      entries.push({
        kind: "item",
        key: "assets",
        label: "New Asset…",
        title: "Add an image or other asset to the project",
        onSelect: onOpenAssets,
      });
    }
    if (onOpenSnippets && !hideSnippets) {
      entries.push({
        kind: "item",
        key: "snippets",
        label: "New Snippet…",
        title: "Add a reusable source snippet to the project",
        onSelect: onOpenSnippets,
      });
    }
  }
  entries.push({
    kind: "item",
    key: "full-source",
    label: "Display Full Source",
    title: "Show the full assembled PreTeXt source for the project",
    onSelect: onShowFullSource,
  });
  return entries;
}
