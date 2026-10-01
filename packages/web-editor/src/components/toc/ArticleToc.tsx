import { Fragment, useLayoutEffect } from "react";
import SectionItem from "./SectionItem";
import NewDivisionRow from "./NewDivisionRow";
import { ChevronIcon } from "../icons";
import { useDivisionActions } from "./useDivisionActions";

import {
  buildDivisionTree,
  getOrphanRoots,
  type DivisionTreeNode,
} from "../../sectionUtils";
import { selectOpenDivisionId } from "../../store/editorStore";
import { useEditorStore } from "../../store/hooks";

/**
 * The rows of `nodes` — a `buildDivisionTree` walk down from `startId` — that
 * are on screen: those whose every ancestor up to `startId` is expanded. One
 * pass, since the walk is depth-first and so reaches a parent before its
 * children.
 */
function visibleRows(
  startId: string,
  nodes: DivisionTreeNode[],
  isExpanded: (id: string) => boolean,
): DivisionTreeNode[] {
  const visible: DivisionTreeNode[] = [];
  const openParents = new Set<string>();
  if (isExpanded(startId)) openParents.add(startId);
  for (const node of nodes) {
    if (openParents.has(node.parentXmlId)) {
      visible.push(node);
      if (isExpanded(node.division.xmlId)) openParents.add(node.division.xmlId);
    }
  }
  return visible;
}

/**
 * The ids from `id`'s parent up to the walk's start division, nearest first,
 * or `null` if `id` isn't in `nodes` at all.
 */
function ancestorsOf(nodes: DivisionTreeNode[], id: string): string[] | null {
  const parentOf = new Map(nodes.map((n) => [n.division.xmlId, n.parentXmlId]));
  if (!parentOf.has(id)) return null;
  const out: string[] = [];
  for (let cur = parentOf.get(id); cur; cur = parentOf.get(cur)) out.push(cur);
  return out;
}

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
  const creating = useEditorStore((s) => s.creating);
  const pendingNewDivision = creating?.kind === "division" ? creating : null;

  const tocExpansion = useEditorStore((s) => s.tocExpansion);
  const setTocExpanded = useEditorStore((s) => s.setTocExpanded);
  const tocRevealedId = useEditorStore((s) => s.tocRevealedId);
  const revealInToc = useEditorStore((s) => s.revealInToc);
  const isOrphansCollapsed = useEditorStore((s) => s.isTocOrphansCollapsed);
  const toggleOrphansCollapsed = useEditorStore(
    (s) => s.toggleTocOrphansCollapsed,
  );

  const { divisions, rootDivision } = useDivisionActions();

  // ── Tree structure ──────────────────────────────────────────────────────────
  const treeNodes =
    rootDivision && divisions
      ? buildDivisionTree(divisions, rootDivision.xmlId)
      : [];

  const orphanTrees =
    rootDivision && divisions
      ? getOrphanRoots(divisions, rootDivision.xmlId).map((orphan) => ({
          orphan,
          subtree: buildDivisionTree(divisions, orphan.xmlId),
        }))
      : [];

  // ── Expand/collapse ─────────────────────────────────────────────────────────
  // A row the author hasn't toggled falls back to the default: only the root
  // is open, so the tree starts as the document's top-level divisions.
  const isExpanded = (id: string) =>
    tocExpansion[id] ?? id === rootDivision?.xmlId;

  const toggleExpand = (id: string) => setTocExpanded(id, !isExpanded(id));

  // ── Keep the active division on screen ──────────────────────────────────────
  // Whenever the active division changes — including one the TOC hasn't
  // revealed yet on mount — open the rows above it, and its own row so the
  // author sees what it contains. Tracked in the store rather than per mount so
  // switching the explorer's view and back doesn't re-open a branch the author
  // has since shut.
  const pendingReveal = (() => {
    if (!activeDivisionId || activeDivisionId === tocRevealedId) return null;
    if (!rootDivision) return null;
    if (activeDivisionId === rootDivision.xmlId) {
      return { ancestors: [], inOrphans: false };
    }
    const placed = ancestorsOf(treeNodes, activeDivisionId);
    if (placed) return { ancestors: placed, inOrphans: false };
    for (const { orphan, subtree } of orphanTrees) {
      const ancestors =
        orphan.xmlId === activeDivisionId
          ? []
          : ancestorsOf(subtree, activeDivisionId);
      if (ancestors) return { ancestors, inOrphans: true };
    }
    // Not in any tree yet (e.g. a just-created division whose ref hasn't
    // landed in its parent): left unrevealed, so it's retried once it is.
    return null;
  })();

  useLayoutEffect(() => {
    if (pendingReveal && activeDivisionId) {
      revealInToc(
        activeDivisionId,
        pendingReveal.ancestors,
        pendingReveal.inOrphans,
      );
    }
  }, [pendingReveal, activeDivisionId, revealInToc]);

  // ── Which IDs have children (used to show/hide the chevron) ────────────────
  const idsWithChildren = new Set(
    treeNodes.map((n) => n.parentXmlId).filter(Boolean) as string[],
  );

  const visibleNodes = rootDivision
    ? visibleRows(rootDivision.xmlId, treeNodes, isExpanded)
    : [];

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

      {/* Unplaced divisions — capped below half the panel and foldable to its
          header, so a long list never crowds out the document's own tree. */}
      {orphanTrees.length > 0 && (
        <div
          data-testid="toc-unplaced"
          className="shrink-0 flex flex-col max-h-[45%] min-h-0 border-t-2 border-dashed border-[#e2c97e] bg-amber-50"
        >
          <button
            type="button"
            className="shrink-0 flex items-center gap-0.5 w-full py-1 px-1 bg-transparent border-none cursor-pointer text-left text-amber-800 hover:bg-amber-100"
            onClick={toggleOrphansCollapsed}
            aria-expanded={!isOrphansCollapsed}
          >
            <span className="flex items-center justify-center w-5 h-5 shrink-0">
              <ChevronIcon open={!isOrphansCollapsed} />
            </span>
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em]">
              Unplaced divisions
            </span>
            <span className="ml-1 text-[0.68rem] font-semibold text-white bg-amber-600/70 rounded-full px-[5px] py-0 leading-[1.4] shrink-0">
              {orphanTrees.length}
            </span>
          </button>
          {!isOrphansCollapsed && (
            <ul className="list-none m-0 min-h-0 overflow-y-auto">
              {orphanTrees.map(({ orphan, subtree }) => {
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
                    {visibleRows(orphan.xmlId, subtree, isExpanded).map((node) => (
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
          )}
        </div>
      )}
    </>
  );
};

export default ArticleToc;
