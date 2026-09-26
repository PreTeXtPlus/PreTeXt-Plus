import { Fragment, useState } from "react";
import SectionItem from "./SectionItem";
import NewDivisionRow from "./NewDivisionRow";
import { canContainDivisions } from "./types";
import { useDivisionActions } from "./useDivisionActions";

import {
  buildDivisionTree,
  canEmbedDivisionRefs,
  getOrphanRoots,
} from "../../sectionUtils";
import { useEditorStore } from "../../store/hooks";

export interface ArticleTocProps {
  /** If true, hides every structural action (add/remove/edit/place a division). */
  readOnly?: boolean;
}

/**
 * The explorer's Contents view: the document's division tree, from the root
 * down through every placed `<plus:* ref/>`, followed by the divisions the
 * document doesn't reach, each heading its own dangling subtree.
 */
const ArticleToc = ({ readOnly }: ArticleTocProps) => {
  const activeDivisionId = useEditorStore((s) => s.activeDivisionId);

  const selectSection = useEditorStore((s) => s.selectSection);
  const addSection = useEditorStore((s) => s.addSection);

  const startSectionEdit = useEditorStore((s) => s.startSectionEdit);
  const setEditDraft = useEditorStore((s) => s.setEditDraft);
  const commitSectionEdit = useEditorStore((s) => s.commitSectionEdit);
  const cancelSectionEdit = useEditorStore((s) => s.cancelSectionEdit);
  const editingId = useEditorStore((s) => s.editingId);
  const editDraft = useEditorStore((s) => s.editDraft);
  const pendingNewDivision = useEditorStore((s) => s.pendingNewDivision);

  const {
    divisions,
    rootDivision,
    handleUnplace,
    handleDelete,
    handleInsertAtCursor,
    handlePlaceOrphan,
    getDivisionType,
  } = useDivisionActions();

  // ── Tree structure ──────────────────────────────────────────────────────────
  const treeNodes =
    rootDivision && divisions
      ? buildDivisionTree(divisions, rootDivision.xmlId)
      : [];

  const orphanRoots =
    rootDivision && divisions
      ? getOrphanRoots(divisions, rootDivision.xmlId)
      : [];

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

  // ── Where a not-yet-created division's draft row goes ──────────────────────
  // At the end of its parent's visible subtree, which is where saving it will
  // put the `<plus:* ref/>` placeholder — so the author sees the position they
  // are about to fill rather than having the row appear somewhere else on save.
  // `after` indexes into `visibleNodes`; -1 means "directly after the root row"
  // and null means the parent isn't on screen (collapsed ancestor, or unplaced).
  const draftPlacement = (() => {
    if (!pendingNewDivision) return null;
    const parentXmlId = pendingNewDivision.parentXmlId;
    if (!parentXmlId) return { after: null, depth: 0 };
    if (rootDivision && parentXmlId === rootDivision.xmlId) {
      return { after: visibleNodes.length - 1, depth: 1 };
    }
    const start = visibleNodes.findIndex(
      (n) => n.division.xmlId === parentXmlId,
    );
    if (start === -1) return null;
    let end = start;
    while (
      end + 1 < visibleNodes.length &&
      visibleNodes[end + 1].depth > visibleNodes[start].depth
    ) {
      end++;
    }
    return { after: end, depth: visibleNodes[start].depth + 2 };
  })();

  const draftRow =
    draftPlacement && editDraft ? (
      <NewDivisionRow
        draft={editDraft}
        depth={draftPlacement.depth}
        parentType={getDivisionType(pendingNewDivision!.parentXmlId)}
        onDraftChange={setEditDraft}
        onCommit={commitSectionEdit}
        onCancel={cancelSectionEdit}
      />
    ) : null;

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
            isRoot
          />
        )}

        {draftPlacement?.after === -1 && draftRow}

        {visibleNodes.map((node, index) => (
          <Fragment key={node.division.xmlId}>
          <SectionItem
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
            parentType={getDivisionType(node.parentXmlId)}
          />
          {draftPlacement?.after === index && draftRow}
          </Fragment>
        ))}

        {/* An unplaced draft (no parent) has no subtree to sit at the end of. */}
        {draftPlacement?.after === null && draftRow}
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
    </>
  );
};

export default ArticleToc;
