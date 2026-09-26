import type { Division } from "../../types/sections";
import {
  buildDivisionTree,
  canEmbedDivisionRefs,
  getOrphanRoots,
} from "../../sectionUtils";
import { canContainDivisions } from "./types";

/**
 * Where a division sits relative to the document, which decides what can be
 * done to it:
 *
 * - `root` — the document itself.
 * - `placed` — reached from the root through `<plus:* ref/>` placeholders;
 *   `parentXmlId` names the division holding its placeholder.
 * - `unplaced` — not reached from the root. An unplaced division heads its own
 *   dangling subtree (`parentXmlId: null`) or sits inside one.
 */
export type DivisionPlacement =
  | { kind: "root" }
  | { kind: "placed"; parentXmlId: string }
  | { kind: "unplaced"; parentXmlId: string | null };

/** Locate `xmlId` in the document tree rooted at `rootXmlId`. */
export function findDivisionPlacement(
  divisions: Division[],
  rootXmlId: string | null,
  xmlId: string,
): DivisionPlacement {
  if (!rootXmlId || xmlId === rootXmlId) return { kind: "root" };
  const placed = buildDivisionTree(divisions, rootXmlId).find(
    (n) => n.division.xmlId === xmlId,
  );
  if (placed) return { kind: "placed", parentXmlId: placed.parentXmlId };
  for (const orphan of getOrphanRoots(divisions, rootXmlId)) {
    if (orphan.xmlId === xmlId) return { kind: "unplaced", parentXmlId: null };
    const inside = buildDivisionTree(divisions, orphan.xmlId).find(
      (n) => n.division.xmlId === xmlId,
    );
    if (inside) return { kind: "unplaced", parentXmlId: inside.parentXmlId };
  }
  return { kind: "unplaced", parentXmlId: null };
}

export interface DivisionAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** What the structural actions do — see `useDivisionActions`. */
export interface DivisionActionHandlers {
  /** Open a draft for a new child of `parentXmlId`. */
  addChild: (parentXmlId: string) => void;
  /** Drop the division's placeholder from `parentXmlId` (the division stays). */
  unplace: (xmlId: string, parentXmlId: string) => void;
  /** Delete the division from the project, and its placeholder from `parentXmlId`. */
  remove: (division: Division, parentXmlId: string | null) => void;
  /** Put an unplaced division's placeholder at the end of the root. */
  placeInDocument: (division: Division) => void;
}

/**
 * The structural actions offered for a division, by where it sits. The root
 * can only grow; a placed division can also be taken out of the document or
 * deleted; an unplaced one can be deleted, and — when it heads its own subtree
 * — put back under the root.
 */
export function divisionActionEntries(
  division: Division,
  placement: DivisionPlacement,
  handlers: DivisionActionHandlers,
): DivisionAction[] {
  // All three formats can hold a child placeholder today (see
  // canEmbedDivisionRefs); the gate stays for a future leaf-only format. A
  // division whose *type* holds no divisions (an <exercises>, a <glossary>)
  // would have no valid type to offer the new child. The root always can.
  const canAddChild =
    canEmbedDivisionRefs(division.sourceFormat) &&
    (placement.kind === "root" || canContainDivisions(division.type));
  const addChild: DivisionAction[] = canAddChild
    ? [
      {
        label: "Add new division",
        onClick: () => handlers.addChild(division.xmlId),
      },
    ]
    : [];

  switch (placement.kind) {
    case "root":
      return addChild;
    case "placed":
      return [
        ...addChild,
        {
          label: "Remove from document",
          onClick: () => handlers.unplace(division.xmlId, placement.parentXmlId),
        },
        {
          label: "Delete from project",
          onClick: () => handlers.remove(division, placement.parentXmlId),
          danger: true,
        },
      ];
    case "unplaced":
      return [
        ...(placement.parentXmlId === null
          ? [
            {
              label: "Place in document",
              onClick: () => handlers.placeInDocument(division),
            },
          ]
          : []),
        {
          label: "Delete from project",
          onClick: () => handlers.remove(division, placement.parentXmlId),
          danger: true,
        },
      ];
  }
}
