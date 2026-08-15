import { useEffect } from "react";
import CleanFindingsList from "./CleanFindingsList";
import { countFixable, countFlagged, type CleanFinding } from "../cleanFindings";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogCopy,
  DialogClose,
  DialogContent,
  DialogActions,
  DialogButton,
} from "./Dialog";

interface LatexCleanDialogProps {
  /** Findings for the buffer, recomputed by the host after every apply. */
  findings: CleanFinding[];
  /** Apply every auto-fixable finding. */
  onApply: () => void;
  /** Apply just one rule's findings. */
  onApplyRule: (ruleId: string) => void;
  onClose: () => void;
}

/**
 * Review dialog for the LaTeX source-cleanup findings.
 *
 * The lightbulb handles one occurrence at a time and the "Clean up LaTeX"
 * command handles all of them at once; this sits in between, and is the only
 * place the author sees the findings that *cannot* be fixed automatically —
 * `\textbf` and friends, which mark appearance rather than meaning and so need
 * a human to choose the PreTeXt element that was meant.
 *
 * The list is not stale after an apply: the host recomputes it from the model,
 * so rows disappear as they are fixed and any newly exposed finding appears
 * (rewrites cascade — `{\bf x}` becomes `\textbf{x}`, which is then flagged).
 */
export default function LatexCleanDialog({
  findings,
  onApply,
  onApplyRule,
  onClose,
}: LatexCleanDialogProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const fixable = countFixable(findings);
  const flagged = countFlagged(findings);

  return (
    <DialogOverlay onClick={onClose}>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="pretext-plus-clean-dialog-title"
        className="h-[min(80%,760px)] w-[min(96%,820px)]"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <div>
            <DialogTitle id="pretext-plus-clean-dialog-title">
              Clean up LaTeX
            </DialogTitle>
            <DialogCopy>
              {findings.length === 0
                ? "This division has no LaTeX left to clean up."
                : summarize(fixable, flagged)}
            </DialogCopy>
          </div>
          <DialogClose onClick={onClose} aria-label="Close cleanup dialog">
            Close
          </DialogClose>
        </DialogHeader>

        <DialogContent single>
          <CleanFindingsList
            findings={findings}
            onApplyRule={onApplyRule}
            emptyMessage="Nothing to clean up — this division is already free of legacy LaTeX markup."
          />
        </DialogContent>

        <DialogActions>
          <DialogButton variant="secondary" onClick={onClose}>
            Close
          </DialogButton>
          <DialogButton onClick={onApply} disabled={fixable === 0}>
            {fixable === 0
              ? "Nothing to fix"
              : `Fix all (${fixable} change${fixable === 1 ? "" : "s"})`}
          </DialogButton>
        </DialogActions>
      </Dialog>
    </DialogOverlay>
  );
}

/** The one-line header count, worded so zero of either half reads naturally. */
function summarize(fixable: number, flagged: number): string {
  const parts: string[] = [];
  if (fixable > 0) {
    parts.push(`${fixable} ${fixable === 1 ? "change" : "changes"} the editor can make for you`);
  }
  if (flagged > 0) {
    parts.push(`${flagged} ${flagged === 1 ? "finding" : "findings"} that need your judgement`);
  }
  return `${parts.join(", and ")}.`;
}
