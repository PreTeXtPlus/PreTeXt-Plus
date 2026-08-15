import { Fragment, useState } from "react";
import clsx from "clsx";
import type { Division } from "../../types/sections";
import type { AssetKind } from "../../types/editor";
import SectionItem from "./SectionItem";
import DivisionMenu, { type DivisionMenuItem } from "./DivisionMenu";
import { canContainDivisions } from "./types";

import {
  assetEmbedCode,
  buildDivisionTree,
  canEmbedDivisionRefs,
  getOrphanRoots,
  insertDivisionRef,
  removeDivisionRef,
} from "../../sectionUtils";
import { buildProjectAssetView, type AssetRow } from "../../assetView";
import { useEditorStore } from "../../store/hooks";
import { ASSET_KIND_LABELS, VISIBLE_ASSET_KINDS } from "../../assetKinds";

export interface ArticleTocProps {
  onOpenAssetPicker?: (initialTab?: "add") => void;
  hideAssets?: boolean;
  /** If true, hides every structural action (add/remove/edit/place a division). */
  readOnly?: boolean;
}

const ArticleToc = ({ onOpenAssetPicker, hideAssets, readOnly }: ArticleTocProps) => {
  const divisions = useEditorStore((s) => s.divisions);
  const rootDivisionId = useEditorStore((s) => s.rootDivisionId);
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);
  const projectAssets = useEditorStore((s) => s.projectAssets) ?? [];

  const selectSection = useEditorStore((s) => s.selectSection);
  const addSection = useEditorStore((s) => s.addSection);
  const removeSection = useEditorStore((s) => s.removeSection);
  const divisionContentChange = useEditorStore((s) => s.divisionContentChange);
  const insertAtCursor = useEditorStore((s) => s.insertAtCursor);

  const openAssetEditor = useEditorStore((s) => s.openAssetEditor);
  const openAssetResolver = useEditorStore((s) => s.openAssetResolver);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const removeAssetRefFromDocument = useEditorStore((s) => s.removeAssetRefFromDocument);
  const duplicateAsset = useEditorStore((s) => s.duplicateAsset);
  const hasAssetDuplicate = useEditorStore((s) => s.hasAssetDuplicate);

  const startSectionEdit = useEditorStore((s) => s.startSectionEdit);
  const setEditDraft = useEditorStore((s) => s.setEditDraft);
  const commitSectionEdit = useEditorStore((s) => s.commitSectionEdit);
  const cancelSectionEdit = useEditorStore((s) => s.cancelSectionEdit);
  const editingId = useEditorStore((s) => s.editingId);
  const editDraft = useEditorStore((s) => s.editDraft);
  const editingIsNew = useEditorStore((s) => s.editingIsNew);

  // ── Tree structure ──────────────────────────────────────────────────────────
  const rootDivision = divisions
    ? (divisions.find((d) => d.xmlId === rootDivisionId) ??
        divisions.find(
          (d) =>
            d.type === "book" || d.type === "article" || d.type === "slideshow",
        ) ??
        divisions[0] ??
        null)
    : null;

  const treeNodes =
    rootDivision && divisions
      ? buildDivisionTree(divisions, rootDivision.xmlId)
      : [];

  const orphanRoots =
    rootDivision && divisions
      ? getOrphanRoots(divisions, rootDivision.xmlId)
      : [];

  // ── Joined asset view — placeholders + project assets, with status ─────────
  const assetView = buildProjectAssetView(divisions, projectAssets);

  const groupedAssetRows = VISIBLE_ASSET_KINDS.map((kind) => ({
    kind,
    rows: assetView.filter((r) => r.kind === kind),
  })).filter((g) => g.rows.length > 0);

  const [assetsExpanded, setAssetsExpanded] = useState(true);

  // The ref of the asset currently being duplicated, so its row can show a
  // spinner. Duplicate re-fetches and re-uploads the bytes (a network
  // round-trip), and unlike the edit modal this sidebar action has no surface
  // of its own to report progress on.
  const [duplicatingRef, setDuplicatingRef] = useState<string | null>(null);

  const handleDuplicateAsset = async (row: AssetRow) => {
    if (!row.asset || duplicatingRef) return;
    setDuplicatingRef(row.ref);
    try {
      await duplicateAsset(row.asset);
    } finally {
      setDuplicatingRef(null);
    }
  };

  // ── Expand/collapse: track which IDs are collapsed (empty = all open) ───────
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const isExpanded = (id: string) => !collapsedIds.has(id);

  const toggleExpand = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Auto-expand ancestors when the active division changes so it's always
  // visible. Done during render (with a previous-value guard) rather than in an
  // effect to avoid cascading renders.
  const [prevActiveId, setPrevActiveId] = useState(activeDivisionId);
  if (activeDivisionId !== prevActiveId) {
    setPrevActiveId(activeDivisionId);
    if (activeDivisionId && rootDivision) {
      const nodeMap = new Map(treeNodes.map((n) => [n.division.xmlId, n]));
      const toReveal = new Set<string>();
      toReveal.add(rootDivision.xmlId);
      let cur: string | null = activeDivisionId;
      while (cur) {
        const node = nodeMap.get(cur);
        if (!node?.parentXmlId) break;
        toReveal.add(node.parentXmlId);
        cur = node.parentXmlId;
      }
      setCollapsedIds((prev) => {
        if ([...toReveal].every((id) => !prev.has(id))) return prev;
        const next = new Set(prev);
        toReveal.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  // ── Which IDs have children (used to show/hide the chevron) ────────────────
  const idsWithChildren = new Set(
    treeNodes.map((n) => n.parentXmlId).filter(Boolean) as string[],
  );

  // ── Compute visible placed nodes (single O(n) depth-first pass) ─────────────
  // visibleParents: IDs whose children should be rendered.
  // A node is rendered if its direct parentXmlId is in visibleParents.
  // It's added to visibleParents only if it itself is not collapsed.
  const visibleNodes: typeof treeNodes = [];
  if (rootDivision) {
    const visibleParents = new Set<string>();
    if (isExpanded(rootDivision.xmlId)) visibleParents.add(rootDivision.xmlId);
    for (const node of treeNodes) {
      if (node.parentXmlId && visibleParents.has(node.parentXmlId)) {
        visibleNodes.push(node);
        if (isExpanded(node.division.xmlId)) {
          visibleParents.add(node.division.xmlId);
        }
      }
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleUnplace = (xmlId: string, parentXmlId: string) => {
    if (!divisions) return;
    const parent = divisions.find((d) => d.xmlId === parentXmlId);
    if (!parent) return;
    divisionContentChange(parent.xmlId, removeDivisionRef(parent.source, xmlId));
  };

  const handleDelete = (division: Division, parentXmlId: string | null) => {
    if (
      !window.confirm(
        `Delete "${division.title || "Untitled"}"? This permanently removes the division.`,
      )
    )
      return;
    if (parentXmlId && divisions) {
      const parent = divisions.find((d) => d.xmlId === parentXmlId);
      if (parent) {
        divisionContentChange(
          parent.xmlId,
          removeDivisionRef(parent.source, division.xmlId),
        );
      }
    }
    removeSection(division.xmlId);
  };

  // The source format of the division currently being edited. Includes the user
  // inserts/copies must match it: a Markdown division needs the `::type{ref}`
  // leaf-directive form and a LaTeX division the `\plus{type}{ref}` macro, since
  // raw `<plus:.../>` XML doesn't survive their conversion. Defaults to PreTeXt
  // when nothing is active.
  const activeFormat =
    divisions?.find((d) => d.xmlId === activeDivisionId)?.sourceFormat ??
    "pretext";

  const handleInsertAtCursor = (division: Division) => {
    insertAtCursor(
      activeFormat === "markdown"
        ? `::${division.type}{ref="${division.xmlId}"}`
        : activeFormat === "latex"
          ? `\\plus{${division.type}}{${division.xmlId}}`
          : `<plus:${division.type} ref="${division.xmlId}"/>`,
    );
  };

  const handlePlaceOrphan = (orphan: Division) => {
    if (!rootDivision) return;
    divisionContentChange(
      rootDivision.xmlId,
      insertDivisionRef(
        rootDivision.source,
        orphan.xmlId,
        orphan.type,
        null,
        rootDivision.sourceFormat,
      ),
    );
  };

  const getDivisionType = (xmlId: string | null) =>
    (xmlId && divisions?.find((d) => d.xmlId === xmlId)?.type) || null;

  // ── Asset row helpers ───────────────────────────────────────────────────────
  const openAssetRow = (row: AssetRow) =>
    row.status === "unlinked"
      ? openAssetResolver(row.kind, row.ref)
      : openAssetEditor(row.kind, row.ref);

  const copyAssetEmbed = (kind: AssetKind, ref: string) => {
    navigator.clipboard
      .writeText(assetEmbedCode(kind, ref, activeFormat))
      .catch(() => {});
  };

  const assetMenuItems = (row: AssetRow): DivisionMenuItem[] => {
    const items: DivisionMenuItem[] = [
      {
        label: row.status === "unlinked" ? "Link / create asset" : "Manage asset",
        onClick: () => openAssetRow(row),
      },
      {
        label: "Copy embed code",
        onClick: () => copyAssetEmbed(row.kind, row.ref),
      },
    ];
    if (hasAssetDuplicate && row.asset) {
      items.push({
        label: "Duplicate asset",
        onClick: () => handleDuplicateAsset(row),
      });
    }
    if (row.status === "unlinked") {
      items.push({
        label: "Remove from document",
        onClick: () => removeAssetRefFromDocument(row.kind, row.ref),
        danger: true,
      });
    } else if (row.asset) {
      items.push({
        label: "Remove from project",
        onClick: () => {
          // Removing the asset alone would leave its placeholders behind (the
          // row would just reappear as "needs asset"), so also strip every
          // `<plus:KIND ref/>` for it from the document — mirroring how
          // deleting a division also removes its references. Confirm first when
          // it's actually placed, since that edits the source.
          if (
            row.inDocument &&
            !window.confirm(
              `Remove "${row.asset!.title}" from the project? This also deletes its ${
                row.inDocument ? "reference(s)" : "reference"
              } from the document.`,
            )
          ) {
            return;
          }
          removeAsset(row.asset!);
          removeAssetRefFromDocument(row.kind, row.ref);
        },
        danger: true,
      });
    }
    return items;
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <ul className="list-none m-0 overflow-y-auto flex-1" role="list">
        {/* Root division — depth 0, always visible */}
        {rootDivision && (
          <SectionItem
            division={rootDivision}
            depth={0}
            isActive={activeDivisionId === rootDivision.xmlId}
            hasChildren={idsWithChildren.has(rootDivision.xmlId)}
            isExpanded={isExpanded(rootDivision.xmlId)}
            onToggleExpand={() => toggleExpand(rootDivision.xmlId)}
            editDraft={editingId === rootDivision.xmlId ? editDraft : null}
            onSelect={() => selectSection(rootDivision.xmlId)}
            onDraftChange={setEditDraft}
            onEditCommit={commitSectionEdit}
            onEditCancel={cancelSectionEdit}
            menuItems={
              readOnly
                ? []
                : [
                    {
                      label: "Edit properties",
                      onClick: () => startSectionEdit(rootDivision),
                    },
                    // All three source formats can hold a child ref placeholder — see
                    // canEmbedDivisionRefs / types/sections.ts — so this is always
                    // shown today, but stays gated for a future leaf-only format.
                    // (A root type always allows children, so no type gate here.)
                    ...(canEmbedDivisionRefs(rootDivision.sourceFormat)
                      ? [
                          {
                            label: "Add new division",
                            onClick: () => addSection(rootDivision.xmlId),
                          },
                        ]
                      : []),
                  ]
            }
            isNew={editingId === rootDivision.xmlId && editingIsNew}
            isRoot
          />
        )}

        {visibleNodes.map((node) => (
          <SectionItem
            key={node.division.xmlId}
            division={node.division}
            depth={node.depth + 1}
            isActive={activeDivisionId === node.division.xmlId}
            hasChildren={idsWithChildren.has(node.division.xmlId)}
            isExpanded={isExpanded(node.division.xmlId)}
            onToggleExpand={() => toggleExpand(node.division.xmlId)}
            editDraft={editingId === node.division.xmlId ? editDraft : null}
            onSelect={() => selectSection(node.division.xmlId)}
            onDraftChange={setEditDraft}
            onEditCommit={commitSectionEdit}
            onEditCancel={cancelSectionEdit}
            menuItems={
              readOnly
                ? []
                : [
                    {
                      label: "Edit properties",
                      onClick: () => startSectionEdit(node.division),
                    },
                    // Add division, but only if the format can embed child refs —
                    // all three (PreTeXt/Markdown/LaTeX) do today; gated for a future
                    // leaf-only format — and only if the division's *type* can hold
                    // divisions at all (an <exercises> or <glossary> can't, so there
                    // would be no valid type to offer the new child).
                    ...(canEmbedDivisionRefs(node.division.sourceFormat) &&
                    canContainDivisions(node.division.type)
                      ? [
                          {
                            label: "Add new division",
                            onClick: () => addSection(node.division.xmlId),
                          },
                        ]
                      : []),
                    {
                      label: "Remove from document",
                      onClick: () => handleUnplace(node.division.xmlId, node.parentXmlId!),
                    },
                    {
                      label: "Delete from project",
                      onClick: () => handleDelete(node.division, node.parentXmlId),
                      danger: true,
                    },
                  ]
            }
            isNew={editingId === node.division.xmlId && editingIsNew}
            parentType={getDivisionType(node.parentXmlId)}
          />
        ))}
      </ul>

      {/* Unplaced divisions */}
      {orphanRoots.length > 0 && (
        <div className="shrink-0 border-t-2 border-dashed border-[#e2c97e] bg-amber-50">
          <div className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-amber-800 pt-[5px] px-2.5 pb-0.5">
            Unplaced divisions
          </div>
          <ul className="list-none m-0 flex-initial overflow-y-visible">
            {orphanRoots.map((orphan) => {
              const subtree = divisions
                ? buildDivisionTree(divisions, orphan.xmlId)
                : [];
              const subtreeIdsWithChildren = new Set(
                subtree.map((n) => n.parentXmlId).filter(Boolean) as string[],
              );
              return (
                <Fragment key={orphan.xmlId}>
                  <SectionItem
                    division={orphan}
                    depth={0}
                    isActive={activeDivisionId === orphan.xmlId}
                    hasChildren={subtreeIdsWithChildren.has(orphan.xmlId)}
                    isExpanded={isExpanded(orphan.xmlId)}
                    onToggleExpand={() => toggleExpand(orphan.xmlId)}
                    editDraft={editingId === orphan.xmlId ? editDraft : null}
                    onSelect={() => selectSection(orphan.xmlId)}
                    onDraftChange={setEditDraft}
                    onEditCommit={commitSectionEdit}
                    onEditCancel={cancelSectionEdit}
                    menuItems={
                      readOnly
                        ? []
                        : [
                            {
                              label: "Edit properties",
                              onClick: () => startSectionEdit(orphan),
                            },
                            {
                              label: "Place in document",
                              onClick: () => handlePlaceOrphan(orphan),
                            },
                            {
                              label: "Insert at cursor",
                              onClick: () => handleInsertAtCursor(orphan),
                            },
                            {
                              label: "Delete from project",
                              onClick: () => handleDelete(orphan, null),
                              danger: true,
                            },
                          ]
                    }
                    // Unplaced, but "Place in document" puts it directly under
                    // the root — so the root's rules are the ones that apply,
                    // and e.g. an article project never offers Part/Chapter.
                    parentType={rootDivision?.type ?? null}
                  />
                  {isExpanded(orphan.xmlId) &&
                    subtree.map((node) => (
                      <SectionItem
                        key={node.division.xmlId}
                        division={node.division}
                        depth={node.depth + 1}
                        isActive={activeDivisionId === node.division.xmlId}
                        hasChildren={subtreeIdsWithChildren.has(node.division.xmlId)}
                        isExpanded={isExpanded(node.division.xmlId)}
                        onToggleExpand={() => toggleExpand(node.division.xmlId)}
                        editDraft={editingId === node.division.xmlId ? editDraft : null}
                        onSelect={() => selectSection(node.division.xmlId)}
                        onDraftChange={setEditDraft}
                        onEditCommit={commitSectionEdit}
                        onEditCancel={cancelSectionEdit}
                        menuItems={
                          readOnly
                            ? []
                            : [
                                {
                                  label: "Edit properties",
                                  onClick: () => startSectionEdit(node.division),
                                },
                                {
                                  label: "Insert at cursor",
                                  onClick: () => handleInsertAtCursor(node.division),
                                },
                                {
                                  label: "Delete from project",
                                  onClick: () => handleDelete(node.division, node.parentXmlId),
                                  danger: true,
                                },
                              ]
                        }
                        parentType={getDivisionType(node.parentXmlId)}
                      />
                    ))}
                </Fragment>
              );
            })}
          </ul>
        </div>
      )}

      {/* Asset refs — kept separate from divisions, folded by default */}
      {!hideAssets && (
        <>
          <div className="shrink-0 border-t border-[#dde0e6] flex flex-col max-h-[220px]">
            <div className="flex items-center justify-between py-1 pl-1 pr-1.5 shrink-0">
              <button
                type="button"
                className="flex items-center gap-1 bg-transparent border-none cursor-pointer py-0.5 px-1 font-[inherit] flex-1 min-w-0 text-left rounded-[3px] hover:bg-[#e3e6ec]"
                onClick={() => setAssetsExpanded((v) => !v)}
                aria-expanded={assetsExpanded}
              >
                <span className="text-[0.7rem] text-[#888] w-2.5 shrink-0">
                  {assetsExpanded ? "▾" : "▸"}
                </span>
                <span>Assets</span>
                {assetView.length > 0 && (
                  <span className="text-[0.68rem] font-semibold text-white bg-slate-400 rounded-full px-[5px] py-0 leading-[1.4] shrink-0">
                    {assetView.length}
                  </span>
                )}
              </button>
            </div>

            {assetsExpanded && (
              <div className="overflow-y-auto flex-1 min-h-0">
                {assetView.length === 0 ? (
                  <p className="m-0 py-2 px-3 text-slate-400 text-[0.78rem]">
                    No assets in this project yet.{" "}
                    {onOpenAssetPicker && (
                      <button
                        type="button"
                        className="bg-transparent border-none text-blue-600 cursor-pointer font-[inherit] text-[0.78rem] p-0 hover:underline"
                        onClick={() => onOpenAssetPicker("add")}
                      >
                        Add one
                      </button>
                    )}
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {groupedAssetRows.map(({ kind, rows }) => (
                      <div key={kind}>
                        <div className="flex items-center gap-1 pt-1 px-2 pb-0.5 text-[0.7rem] font-semibold text-slate-500 uppercase tracking-[0.04em]">
                          {ASSET_KIND_LABELS[kind]}
                        </div>
                        <ul className="list-none m-0 pt-0 px-0 pb-1">
                          {rows.map((row) => {
                            const isUnlinked = row.status === "unlinked";
                            const isMissingShortDescription =
                              row.asset &&
                              row.kind === "image" &&
                              !row.asset.shortDescription?.trim();
                            const isBusy = duplicatingRef === row.ref;
                            return (
                              <li
                                key={row.ref}
                                className={clsx(
                                  "group flex items-center gap-1.5 py-[3px] pr-1.5 pl-4 min-h-7 hover:bg-[#e8eaf0]",
                                  isBusy && "opacity-60 pointer-events-none",
                                )}
                              >
                                {(row.asset?.thumbnailUrl || row.asset?.url) ? (
                                  <img
                                    src={row.asset?.thumbnailUrl || row.asset.url}
                                    className="h-[30px] cursor-pointer"
                                    onClick={() => openAssetRow(row)}
                                  />
                                ) : (
                                  <span
                                    className={clsx(
                                      "inline-flex items-center justify-center w-[30px] h-[30px] cursor-pointer text-[0.85rem] rounded bg-[#eef2f7] text-slate-400",
                                      isUnlinked && "bg-amber-100 text-amber-700",
                                    )}
                                    onClick={() => openAssetRow(row)}
                                    title={row.status === "unlinked" ? "No asset — click to link" : undefined}
                                    aria-hidden="true"
                                  >
                                    {row.status === "unlinked" ? "⚠" : "🖼"}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="flex-1 min-w-0 flex flex-col items-start gap-px overflow-hidden border-none bg-transparent p-0 font-[inherit] text-left cursor-pointer"
                                  onClick={() => openAssetRow(row)}
                                  title={
                                    row.status === "unlinked"
                                      ? "No asset for this reference — click to link or create one"
                                      : "Manage asset"
                                  }
                                >
                                  <span className="text-[0.78rem] text-slate-700 overflow-hidden text-ellipsis whitespace-nowrap">
                                    {row.asset?.title ?? row.ref}
                                  </span>
                                  <span
                                    className={clsx(
                                      "text-[0.68rem] font-mono overflow-hidden text-ellipsis whitespace-nowrap",
                                      isUnlinked || isMissingShortDescription
                                        ? "text-amber-700"
                                        : "text-slate-400",
                                    )}
                                  >
                                    {row.status === "unlinked"
                                      ? `${row.ref} — needs asset`
                                      : row.status === "unused"
                                        ? `${row.ref} — not placed`
                                        : row.ref}
                                    {row.asset?.contentType && ` · ${row.asset.contentType}`}
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
                                      aria-label="Duplicating asset"
                                      title="Duplicating…"
                                    />
                                  ) : (
                                    <DivisionMenu items={assetMenuItems(row)} />
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {onOpenAssetPicker && (
            <div className="block w-full bg-transparent border-none border-t border-[#dde0e6] py-[7px] px-2.5 font-[inherit] text-[0.78rem] text-left shrink-0">
              <button
                type="button"
                className="bg-transparent border-none text-blue-600 cursor-pointer py-0 px-0.5 hover:bg-blue-50 hover:underline"
                onClick={() => onOpenAssetPicker()}
              >
                Manage
              </button>
              <button
                type="button"
                className="bg-transparent border-none text-blue-600 cursor-pointer py-0 px-0.5 hover:bg-blue-50 hover:underline"
                onClick={() => onOpenAssetPicker("add")}
              >
                Add
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
};

export default ArticleToc;
