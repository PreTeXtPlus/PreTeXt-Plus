import { formatPretext } from "@pretextbook/format";
import type { SourceFormat } from "../types/editor";
import type { MenuEntry } from "./MenuDropdown";

/** The docinfo editor is named for what that format keeps in it. */
const docinfoNaming = (
  sourceFormat: SourceFormat,
): { label: string; title: string } =>
  sourceFormat === "latex"
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
  sourceFormat: SourceFormat;
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
      ...docinfoNaming(sourceFormat),
      onSelect: onOpenDocinfoEditor,
    });
    if (onOpenAssets && !hideAssets) {
      entries.push({
        kind: "item",
        key: "assets",
        label: "Assets…",
        title: "Manage the project's images and other assets",
        onSelect: onOpenAssets,
      });
    }
    if (onOpenSnippets && !hideSnippets) {
      entries.push({
        kind: "item",
        key: "snippets",
        label: "Snippets…",
        title: "Manage the project's reusable source snippets",
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
