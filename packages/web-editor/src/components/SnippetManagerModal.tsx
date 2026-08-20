import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Snippet } from "../types/editor";
import { useEditorStore } from "../store/hooks";
import { snippetEmbedCode, sanitizeXmlId } from "../sectionUtils";
import { buildProjectSnippetView, type SnippetRow } from "../snippetView";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogTabBar,
  DialogTab,
  DialogContent,
  DialogLabel,
  DialogHelperCopy,
  DialogActions,
  DialogButton,
} from "./Dialog";

export interface SnippetManagerModalProps {
  open: boolean;
  onClose: () => void;
  /** Which main tab to show on open. Defaults to "in-document". No effect in resolve mode. */
  initialTab?: SnippetManagerMainTab;
  /**
   * When set, the modal opens in "resolve" mode for an unresolved
   * `<plus:snippet ref="..."/>` placeholder: whatever snippet the user
   * picks/creates is bound to this placeholder (its ref is rewritten in the
   * source) instead of copying an embed code.
   */
  resolveTarget?: { ref: string } | null;
  /**
   * Create a new snippet under `ref` (bare, empty source — filled in
   * afterward via the snippet editor). Host is responsible for rejecting a
   * `ref` collision with another Division/Asset/Snippet.
   */
  onCreateSnippet?: (ref: string) => Promise<Snippet>;
  /** Remove a snippet from the project. */
  onRemoveSnippet?: (snippet: Snippet) => void;
  /**
   * Duplicate a snippet under a fresh ref. May be async; the row shows a busy
   * state until it settles, then the manager closes as the editor opens on
   * the new copy. When omitted, the Duplicate control is hidden.
   */
  onDuplicateSnippet?: (snippet: Snippet) => void | Promise<void>;
  /** Notify that a snippet now exists in the project (optimistic pool add). */
  onSnippetAdded: (snippet: Snippet) => void;
  /** Rewrite in-document `<plus:snippet ref="oldRef"/>` placeholders to `newRef`. */
  onResolveRef: (oldRef: string, newRef: string) => void;
}

export type SnippetManagerMainTab = "in-document" | "add";
type MainTab = SnippetManagerMainTab;

/**
 * A throwaway client-side id for a locally-created snippet, used only in the
 * demo/no-host fallback branch where the host provides no persistence
 * callback to mint a real id.
 */
function localSnippetId(): string {
  return `snippet-${Date.now()}`;
}

const SnippetManagerModal = ({
  open,
  onClose,
  initialTab,
  resolveTarget,
  onCreateSnippet,
  onRemoveSnippet,
  onDuplicateSnippet,
  onSnippetAdded,
  onResolveRef,
}: SnippetManagerModalProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  // The embed code the user copies is matched to the division they're editing:
  // a Markdown division needs `::snippet{ref="x"}`, since raw `<plus:.../>`
  // XML pasted into Markdown doesn't survive conversion. Falls back to PreTeXt.
  const activeFormat =
    divisions?.find((d) => d.xmlId === activeDivisionId)?.sourceFormat ??
    "pretext";
  const embedFor = (ref: string) => snippetEmbedCode(ref, activeFormat);
  // Authoritative project-snippet pool, owned by the store.
  const projectSnippets = useEditorStore((s) => s.projectSnippets) ?? [];
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];
  const openSnippetEditor = useEditorStore((s) => s.openSnippetEditor);
  const openSnippetResolver = useEditorStore((s) => s.openSnippetResolver);
  const removeSnippetRefFromDocument = useEditorStore(
    (s) => s.removeSnippetRefFromDocument,
  );

  const [tab, setTab] = useState<MainTab>(initialTab ?? "in-document");

  // Add state
  const [refValue, setRefValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Copy feedback, keyed by `ref`.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Row whose Duplicate is in flight, keyed by `ref`.
  const [duplicatingKey, setDuplicatingKey] = useState<string | null>(null);

  // Escape-to-close.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const snippetView = buildProjectSnippetView(divisions, projectSnippets);

  // Every ref already in use, project-wide — a snippet's ref must not collide
  // with a Division's xml:id, an Asset's ref, or another Snippet's ref.
  const takenRefs = new Set<string>([
    ...(divisions ?? []).map((d) => d.xmlId),
    ...projectAssets.map((a) => a.ref).filter((r): r is string => !!r),
    ...projectSnippets.map((s) => s.ref),
  ]);

  // ── Commit a freshly-created snippet ──────────────────────────────────────
  const commitSnippet = (snippet: Snippet) => {
    onSnippetAdded(snippet);
    if (resolveTarget) {
      if (snippet.ref) onResolveRef(resolveTarget.ref, snippet.ref);
      onClose();
      return;
    }
    if (snippet.ref) {
      navigator.clipboard?.writeText(embedFor(snippet.ref)).catch(() => {});
      openSnippetEditor(snippet.ref);
    }
    onClose();
  };

  const handleCopy = (ref: string) => {
    navigator.clipboard?.writeText(embedFor(ref)).catch(() => {});
    setCopiedKey(ref);
    setTimeout(() => setCopiedKey((k) => (k === ref ? null : k)), 2000);
  };

  const handleCreate = async () => {
    const sanitized = sanitizeXmlId(refValue);
    if (!sanitized) {
      setCreateError("Reference can't be empty.");
      return;
    }
    if (takenRefs.has(sanitized)) {
      setCreateError(`Reference "${sanitized}" is already in use. Choose a unique reference.`);
      return;
    }
    setCreateError(null);
    if (onCreateSnippet) {
      setIsCreating(true);
      try {
        const snippet = await onCreateSnippet(sanitized);
        commitSnippet(snippet);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Failed to create snippet.");
      } finally {
        setIsCreating(false);
      }
    } else {
      commitSnippet({ id: localSnippetId(), ref: sanitized, source: "", sourceFormat: "pretext" });
    }
  };

  // ── "In Document" tab — the joined project-snippet view ───────────────────
  const renderInDocument = () => {
    if (snippetView.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-4 text-slate-500 text-[0.9rem] text-center">
          <p>No snippets in this project yet.</p>
          <DialogButton onClick={() => setTab("add")}>
            Add a snippet
          </DialogButton>
        </div>
      );
    }

    const renderRow = (row: SnippetRow) => {
      const isDuplicating = duplicatingKey === row.ref;
      const onOpen = () => {
        if (row.status === "unlinked") {
          openSnippetResolver(row.ref);
        } else {
          openSnippetEditor(row.ref);
          onClose();
        }
      };
      const preview = row.snippet?.source.trim().split("\n")[0]?.slice(0, 60);
      return (
        <li
          key={row.ref}
          data-testid="sm-doc-row"
          className="flex items-center justify-between gap-2 py-[0.45rem] px-2 rounded hover:bg-slate-50"
        >
          <button
            type="button"
            data-testid="sm-row-info-btn"
            className="group flex-1 min-w-0 flex flex-col items-start gap-0.5 overflow-hidden text-left bg-transparent border-none p-0 cursor-pointer"
            onClick={onOpen}
            title={
              row.status === "unlinked"
                ? "No snippet for this reference — click to link or create one"
                : "Manage snippet"
            }
          >
            <span className="text-sm text-slate-900 font-mono whitespace-nowrap overflow-hidden text-ellipsis group-hover:underline">
              {row.ref}
            </span>
            {preview && (
              <span className="text-[0.72rem] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
                {preview}
              </span>
            )}
          </button>
          {row.status === "unlinked" && (
            <span
              className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.04em] whitespace-nowrap rounded-full py-px px-[7px] text-amber-800 bg-amber-100"
              title="No snippet for this reference"
            >
              needs snippet
            </span>
          )}
          {row.status === "unused" && (
            <span
              className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.04em] whitespace-nowrap rounded-full py-px px-[7px] text-slate-600 bg-slate-200"
              title="Not referenced in the document yet"
            >
              not placed
            </span>
          )}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="text-[0.75rem] py-0.5 px-2 border border-slate-300 rounded bg-white text-slate-700 cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100 hover:bg-slate-100 hover:border-slate-400"
              onClick={onOpen}
            >
              {row.status === "unlinked" ? "Link / create" : "Manage"}
            </button>
            <button
              type="button"
              className={clsx(
                "text-[0.75rem] py-0.5 px-2 border rounded cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100",
                copiedKey === row.ref
                  ? "text-emerald-600 border-emerald-300 bg-emerald-50"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-400",
              )}
              onClick={() => handleCopy(row.ref)}
              title={`Copy ${embedFor(row.ref)}`}
            >
              {copiedKey === row.ref ? "Copied!" : "Copy embed code"}
            </button>
            {onDuplicateSnippet && row.snippet && (
              <button
                type="button"
                className="text-[0.75rem] py-0.5 px-2 border border-slate-300 rounded bg-white text-slate-700 cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100 hover:bg-slate-100 hover:border-slate-400"
                disabled={isDuplicating}
                onClick={async () => {
                  setDuplicatingKey(row.ref);
                  try {
                    await onDuplicateSnippet(row.snippet!);
                    onClose();
                  } catch {
                    setDuplicatingKey(null);
                  }
                }}
                title="Create a copy of this snippet under a new reference"
              >
                {isDuplicating ? "Duplicating…" : "Duplicate"}
              </button>
            )}
            {onRemoveSnippet && row.snippet && (
              <button
                type="button"
                className="text-[0.75rem] py-0.5 px-2 border rounded cursor-pointer leading-[1.5] whitespace-nowrap transition-colors duration-100 text-red-700 border-red-300 bg-white hover:bg-red-50 hover:border-red-400"
                onClick={() => {
                  if (
                    row.inDocument &&
                    !window.confirm(
                      `Remove snippet "${row.snippet!.ref}" from the project? This also deletes its reference(s) from the document.`,
                    )
                  ) {
                    return;
                  }
                  onRemoveSnippet(row.snippet!);
                  removeSnippetRefFromDocument(row.ref);
                  onClose();
                }}
                title="Remove from project"
              >
                Remove
              </button>
            )}
          </div>
        </li>
      );
    };

    return (
      <div className="p-1">
        <ul className="list-none m-0 p-0">{snippetView.map(renderRow)}</ul>
      </div>
    );
  };

  // ── "Add Snippet" tab ──────────────────────────────────────────────────────
  const renderAdd = () => (
    <div className="flex flex-col gap-2 pt-1 px-1 pb-2 max-w-[420px]">
      <DialogLabel htmlFor="sm-add-ref">Reference id</DialogLabel>
      <input
        id="sm-add-ref"
        type="text"
        className="text-[0.9rem] border border-slate-300 rounded py-1.5 px-2.5 bg-white outline-none text-slate-900 w-full focus:border-[#0e639c] focus:shadow-[0_0_0_2px_rgba(14,99,156,0.15)]"
        placeholder="my-snippet"
        value={refValue}
        onChange={(e) => setRefValue(e.target.value)}
        disabled={isCreating}
        autoFocus
      />
      <DialogHelperCopy as="p">
        You'll write the snippet's source content in the next step.
      </DialogHelperCopy>
      {createError && (
        <p className="m-0 py-[0.4rem] px-[0.6rem] bg-[#fde8e8] text-red-700 rounded text-[0.83rem]">
          {createError}
        </p>
      )}
      <DialogButton
        onClick={handleCreate}
        disabled={!refValue.trim() || isCreating}
      >
        {isCreating ? "Creating…" : "Create"}
      </DialogButton>
    </div>
  );

  const renderResolveMode = (target: { ref: string }) => (
    <>
      <DialogHeader>
        <DialogTitle>Link snippet</DialogTitle>
        <DialogClose onClick={onClose} aria-label="Close">
          ✕
        </DialogClose>
      </DialogHeader>
      <DialogContent single>
        <DialogHelperCopy as="p" className="pb-2 px-2">
          The reference <code>{target.ref}</code> has no snippet yet. Create
          one — the reference in your document will be updated to match.
        </DialogHelperCopy>
        {renderAdd()}
      </DialogContent>
      <DialogActions>
        <DialogButton variant="secondary" onClick={onClose}>
          Cancel
        </DialogButton>
      </DialogActions>
    </>
  );

  return (
    <DialogOverlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Dialog
        className="w-[min(90%,700px)] h-[min(85%,600px)] [@media(max-height:600px)]:h-[98%]"
        role="dialog"
        aria-modal="true"
        aria-label="Snippet manager"
      >
        {resolveTarget ? (
          renderResolveMode(resolveTarget)
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Snippets</DialogTitle>
              <DialogClose onClick={onClose} aria-label="Close">
                ✕
              </DialogClose>
            </DialogHeader>

            <DialogTabBar>
              <DialogTab
                active={tab === "in-document"}
                onClick={() => setTab("in-document")}
              >
                Snippets
                {snippetView.length > 0 && (
                  <span className="inline-flex items-center justify-center ml-[5px] text-[0.68rem] font-bold text-slate-600 bg-slate-200 rounded-full px-[5px] min-w-[16px] leading-[1.4]">
                    {snippetView.length}
                  </span>
                )}
              </DialogTab>
              <DialogTab active={tab === "add"} onClick={() => setTab("add")}>
                Add Snippet
              </DialogTab>
            </DialogTabBar>

            <DialogContent single>
              {tab === "in-document" ? renderInDocument() : renderAdd()}
            </DialogContent>

            <DialogActions>
              <DialogButton variant="secondary" onClick={onClose}>
                Close
              </DialogButton>
            </DialogActions>
          </>
        )}
      </Dialog>
    </DialogOverlay>
  );
};

export default SnippetManagerModal;
