/**
 * Import an outside document *into* a division of the project being edited.
 *
 * The wizard, the conversion and the retargeting are all
 * `@pretextbook/import`'s; what this adds is the half only the editor knows —
 * which division is receiving the import, what levels it may become, and which
 * `xml:id`s are already spoken for — and the translation of the result into the
 * editor's own two edits (see `insertImport.ts`).
 *
 * Import mode is locked to "converted". The native projection is the cleaned
 * LaTeX or Markdown source, and while a division here *can* hold that (unlike a
 * file host, our divisions carry their own `sourceFormat`), the placeholders
 * the insert writes are generated for the converted pool only — so offering the
 * choice would promise something the records cannot deliver.
 */
import { ImportWizard, type ImportEngine } from "@pretextbook/import/react";
import {
  isDivisionTag,
  serializeInsertToRecords,
  type ImportedProjectSuccess,
  type PretextDivisionTag,
} from "@pretextbook/import";
import "@pretextbook/import/react.css";
import { planInsertImport, type InsertImportPlan } from "../insertImport";
import type { Division, DivisionType } from "../types/sections";
import { getSelectableDivisionTypes } from "./toc/types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
} from "./Dialog";

interface InsertImportDialogProps {
  /** The division the import is landing in. */
  parent: Division;
  /** The level the import becomes by default — a child of `parent`. */
  defaultChildType: DivisionType;
  /** Every `ref` already used in the project (divisions, assets, snippets). */
  takenIds: string[];
  /** Converters on offer; order is precedence. */
  engines: ImportEngine[];
  /** Apply the import. Both edits arrive together so they can be one transaction. */
  onConfirm: (plan: InsertImportPlan) => void | Promise<void>;
  onClose: () => void;
}

/**
 * The division levels this import may become, narrowed to what both sides
 * accept: the types `parent` can legally hold, and the tags the importer knows
 * how to retarget onto. Anything else would be offered and then silently not
 * happen.
 */
function offeredTargetTags(parentType: DivisionType | null | undefined) {
  return getSelectableDivisionTypes(parentType).filter((type): type is
    & DivisionType
    & PretextDivisionTag => isDivisionTag(type));
}

const InsertImportDialog = ({
  parent,
  defaultChildType,
  takenIds,
  engines,
  onConfirm,
  onClose,
}: InsertImportDialogProps) => {
  const targetTags = offeredTargetTags(parent.type);
  // The importer has to be given a tag it recognises. `subsection` is the
  // safe floor: it nests inside anything that takes divisions at all.
  const defaultTargetTag: PretextDivisionTag = isDivisionTag(defaultChildType)
    ? defaultChildType
    : (targetTags[0] ?? "subsection");

  const handleConfirm = async (result: ImportedProjectSuccess) => {
    const destination = result.destination;
    if (destination.kind !== "insert") return;

    const records = serializeInsertToRecords(result.project, {
      targetTag: destination.targetTag,
      unwrapRoot: result.insert?.unwrapRoot ?? false,
    });
    await onConfirm(planInsertImport(records, parent));
    onClose();
  };

  return (
    <DialogOverlay onClick={onClose}>
      <Dialog
        className="max-w-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>
            Import into {parent.title || parent.xmlId}
          </DialogTitle>
          <DialogClose onClick={onClose} />
        </DialogHeader>
        <DialogContent>
          <ImportWizard
            engines={engines}
            onConfirm={handleConfirm}
            onCancel={onClose}
            lockImportMode
            defaultImportMode="converted"
            insertTarget={{
              documentLabel: parent.title || parent.xmlId,
              defaultTargetTag,
              targetTags: targetTags.length > 0 ? targetTags : undefined,
              takenIds,
              // Unused here: a division pool has no files, so nothing needs a
              // path relative to the one receiving the include. The importer
              // takes it because a filesystem host does.
              hrefBase: "",
            }}
          />
        </DialogContent>
      </Dialog>
    </DialogOverlay>
  );
};

export default InsertImportDialog;
