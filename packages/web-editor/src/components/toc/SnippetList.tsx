import { useState } from "react";
import clsx from "clsx";
import DivisionMenu, { type DivisionMenuItem } from "./DivisionMenu";
import { snippetEmbedCode } from "../../sectionUtils";
import { buildProjectSnippetView, type SnippetRow } from "../../snippetView";
import { useEditorStore } from "../../store/hooks";
import { useDivisionActions } from "./useDivisionActions";

export interface SnippetListProps {
  onOpenSnippetPicker?: (initialTab?: "add") => void;
}

/** The explorer's Snippets view: every snippet placeholder and project snippet, with status. */
const SnippetList = ({ onOpenSnippetPicker }: SnippetListProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectSnippets = useEditorStore((s) => s.projectSnippets) ?? [];
  const openSnippetEditor = useEditorStore((s) => s.openSnippetEditor);
  const openSnippetResolver = useEditorStore((s) => s.openSnippetResolver);
  const removeSnippet = useEditorStore((s) => s.removeSnippet);
  const removeSnippetRefFromDocument = useEditorStore((s) => s.removeSnippetRefFromDocument);
  const duplicateSnippet = useEditorStore((s) => s.duplicateSnippet);
  const hasSnippetDuplicate = useEditorStore((s) => s.hasSnippetDuplicate);
  const { activeFormat } = useDivisionActions();

  // ── Joined snippet view — placeholders + project snippets, with status ───────
  const snippetView = buildProjectSnippetView(divisions, projectSnippets);

  const [duplicatingSnippetRef, setDuplicatingSnippetRef] = useState<string | null>(null);

  const handleDuplicateSnippet = async (row: SnippetRow) => {
    if (!row.snippet || duplicatingSnippetRef) return;
    setDuplicatingSnippetRef(row.ref);
    try {
      await duplicateSnippet(row.snippet);
    } finally {
      setDuplicatingSnippetRef(null);
    }
  };

  // ── Snippet row helpers ─────────────────────────────────────────────────────
  const openSnippetRow = (row: SnippetRow) =>
    row.status === "unlinked"
      ? openSnippetResolver(row.ref)
      : openSnippetEditor(row.ref);

  const copySnippetEmbed = (ref: string) => {
    navigator.clipboard
      ?.writeText(snippetEmbedCode(ref, activeFormat))
      .catch(() => {});
  };

  const snippetMenuItems = (row: SnippetRow): DivisionMenuItem[] => {
    const items: DivisionMenuItem[] = [
      {
        label: row.status === "unlinked" ? "Link / create snippet" : "Manage snippet",
        onClick: () => openSnippetRow(row),
      },
      {
        label: "Copy embed code",
        onClick: () => copySnippetEmbed(row.ref),
      },
    ];
    if (hasSnippetDuplicate && row.snippet) {
      items.push({
        label: "Duplicate snippet",
        onClick: () => handleDuplicateSnippet(row),
      });
    }
    if (row.status === "unlinked") {
      items.push({
        label: "Remove from document",
        onClick: () => removeSnippetRefFromDocument(row.ref),
        danger: true,
      });
    } else if (row.snippet) {
      items.push({
        label: "Remove from project",
        onClick: () => {
          if (
            row.inDocument &&
            !window.confirm(
              `Remove snippet "${row.snippet!.ref}" from the project? This also deletes its ${
                row.inDocument ? "reference(s)" : "reference"
              } from the document.`,
            )
          ) {
            return;
          }
          removeSnippet(row.snippet!);
          removeSnippetRefFromDocument(row.ref);
        },
        danger: true,
      });
    }
    return items;
  };

  return (
    <>
      <div className="overflow-y-auto flex-1 min-h-0">
        {snippetView.length === 0 ? (
          <p className="m-0 py-2 px-3 text-slate-400 text-[0.78rem]">
            No snippets in this project yet.{" "}
            {onOpenSnippetPicker && (
              <button
                type="button"
                className="bg-transparent border-none text-blue-600 cursor-pointer font-[inherit] text-[0.78rem] p-0 hover:underline"
                onClick={() => onOpenSnippetPicker("add")}
              >
                Add one
              </button>
            )}
          </p>
        ) : (
          <div className="flex flex-col">
            <ul className="list-none m-0 pt-0 px-0 pb-1">
              {snippetView.map((row) => {
                const isUnlinked = row.status === "unlinked";
                const isBusy = duplicatingSnippetRef === row.ref;
                return (
                  <li
                    key={row.ref}
                    className={clsx(
                      "group flex items-center gap-1.5 py-[3px] pr-1.5 pl-4 min-h-7 hover:bg-[#e8eaf0]",
                      isBusy && "opacity-60 pointer-events-none",
                    )}
                  >
                    <span
                      className={clsx(
                        "inline-flex items-center justify-center w-[30px] h-[30px] cursor-pointer text-[0.85rem] rounded bg-[#eef2f7] text-slate-400",
                        isUnlinked && "bg-amber-100 text-amber-700",
                      )}
                      onClick={() => openSnippetRow(row)}
                      title={row.status === "unlinked" ? "No snippet — click to link" : undefined}
                      aria-hidden="true"
                    >
                      {row.status === "unlinked" ? "⚠" : "⌘"}
                    </span>
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex flex-col items-start gap-px overflow-hidden border-none bg-transparent p-0 font-[inherit] text-left cursor-pointer"
                      onClick={() => openSnippetRow(row)}
                      title={
                        row.status === "unlinked"
                          ? "No snippet for this reference — click to link or create one"
                          : "Manage snippet"
                      }
                    >
                      <span
                        className={clsx(
                          "text-[0.78rem] font-mono overflow-hidden text-ellipsis whitespace-nowrap",
                          isUnlinked ? "text-amber-700" : "text-slate-700",
                        )}
                      >
                        {row.status === "unlinked"
                          ? `${row.ref} — needs snippet`
                          : row.status === "unused"
                            ? `${row.ref} — not placed`
                            : row.ref}
                      </span>
                    </button>
                    <div
                      className={clsx(
                        "flex items-center shrink-0 opacity-0 pointer-events-none transition-opacity duration-100 group-hover:opacity-100 group-hover:pointer-events-auto",
                        isBusy && "opacity-100 pointer-events-auto",
                      )}
                    >
                      {isBusy ? (
                        <span
                          className="inline-block w-[14px] h-[14px] border-2 border-slate-300 border-t-emerald-500 rounded-full animate-[spin_0.8s_linear_infinite]"
                          role="status"
                          aria-label="Duplicating snippet"
                          title="Duplicating…"
                        />
                      ) : (
                        <DivisionMenu items={snippetMenuItems(row)} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {onOpenSnippetPicker && (
        <div className="block w-full bg-transparent border-none border-t border-[#dde0e6] py-[7px] px-2.5 font-[inherit] text-[0.78rem] text-left shrink-0 flex justify-around">
          <button
            type="button"
            data-testid="toc-snippets-btn"
            className="bg-transparent border-none text-blue-600 cursor-pointer hover:bg-blue-50 hover:underline"
            onClick={() => onOpenSnippetPicker()}
          >
            Manage
          </button>
          <button
            type="button"
            data-testid="toc-snippets-btn"
            className="bg-transparent border-none text-blue-600 cursor-pointer hover:bg-blue-50 hover:underline"
            onClick={() => onOpenSnippetPicker("add")}
          >
            Add
          </button>
        </div>
      )}
    </>
  );
};

export default SnippetList;
