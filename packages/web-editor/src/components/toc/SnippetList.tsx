import clsx from "clsx";
import { buildProjectSnippetView, type SnippetRow } from "../../snippetView";
import { useEditorStore } from "../../store/hooks";

export interface SnippetListProps {
  onOpenSnippetPicker?: (initialTab?: "add") => void;
}

/**
 * The explorer's Snippets view: every snippet placeholder and project snippet,
 * with status. Selecting a snippet opens its source in the code editor, whose
 * title bar carries its settings; a placeholder with no snippet behind it opens
 * the snippet manager to link or create one instead, having no source to open.
 */
const SnippetList = ({ onOpenSnippetPicker }: SnippetListProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const projectSnippets = useEditorStore((s) => s.projectSnippets) ?? [];
  const openItem = useEditorStore((s) => s.openItem);
  const openSnippet = useEditorStore((s) => s.openSnippet);
  const openSnippetResolver = useEditorStore((s) => s.openSnippetResolver);

  // ── Joined snippet view — placeholders + project snippets, with status ───────
  const snippetView = buildProjectSnippetView(divisions, projectSnippets);

  const openSnippetRow = (row: SnippetRow) =>
    row.status === "unlinked"
      ? openSnippetResolver(row.ref)
      : openSnippet(row.ref);

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
          <ul className="list-none m-0 pt-0 px-0 pb-1">
            {snippetView.map((row) => {
              const isUnlinked = row.status === "unlinked";
              const isOpen =
                openItem.kind === "snippet" && openItem.ref === row.ref;
              return (
                <li
                  key={row.ref}
                  data-testid={`snippet-row-${row.ref}`}
                  className={clsx(
                    "flex items-center gap-1.5 py-[3px] pr-1.5 pl-4 min-h-7 border-l-[3px]",
                    isOpen
                      ? "bg-[#e0e8ff] border-l-blue-600"
                      : "border-transparent hover:bg-[#e8eaf0]",
                  )}
                >
                  <span
                    className={clsx(
                      "inline-flex items-center justify-center w-[30px] h-[30px] cursor-pointer text-[0.85rem] rounded bg-[#eef2f7] text-slate-400",
                      isUnlinked && "bg-amber-100 text-amber-700",
                    )}
                    onClick={() => openSnippetRow(row)}
                    aria-hidden="true"
                  >
                    {isUnlinked ? "⚠" : "⌘"}
                  </span>
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex flex-col items-start gap-px overflow-hidden border-none bg-transparent p-0 font-[inherit] text-left cursor-pointer"
                    onClick={() => openSnippetRow(row)}
                    aria-current={isOpen ? "true" : undefined}
                    title={
                      isUnlinked
                        ? "No snippet for this reference — click to link or create one"
                        : "Open snippet"
                    }
                  >
                    <span
                      className={clsx(
                        "text-[0.78rem] font-mono overflow-hidden text-ellipsis whitespace-nowrap",
                        isUnlinked ? "text-amber-700" : "text-slate-700",
                        isOpen && "font-semibold",
                      )}
                    >
                      {isUnlinked
                        ? `${row.ref} — needs snippet`
                        : row.status === "unused"
                          ? `${row.ref} — not placed`
                          : row.ref}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
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
