import { Fragment, useState } from "react";
import SectionItem from "./SectionItem";
import NewDivisionRow from "./NewDivisionRow";
import { useDivisionActions } from "./useDivisionActions";

import { buildDivisionTree, getOrphanRoots } from "../../sectionUtils";
import { selectOpenDivisionId } from "../../store/editorStore";
import { useEditorStore } from "../../store/hooks";

/**
 * The explorer's Contents view: the document's division tree, from the root
 * down through every placed `<plus:* ref/>`, followed by the divisions the
 * document doesn't reach, each heading its own dangling subtree. Selecting a
 * row opens that division; its properties and structural actions live in the
 * settings drawer under the editor's title bar.
 */
const ArticleToc = () => {
  const activeDivisionId = useEditorStore(selectOpenDivisionId);

  const selectSection = useEditorStore((s) => s.selectSection);
  const editDraft = useEditorStore((s) => s.editDraft);
  const pendingNewDivision = useEditorStore((s) => s.pendingNewDivision);

  const { divisions, rootDivision } = useDivisionActions();

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
      <NewDivisionRow draft={editDraft} depth={draftPlacement.depth} />
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
            onSelect={() => selectSection(rootDivision.xmlId)}
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
            onSelect={() => selectSection(node.division.xmlId)}
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
                    onSelect={() => selectSection(orphan.xmlId)}
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
                        onSelect={() => selectSection(node.division.xmlId)}
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
