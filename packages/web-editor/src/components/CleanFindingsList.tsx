import clsx from "clsx";
import type { CleanFinding } from "../cleanFindings";

/**
 * The cleanup findings for a buffer, one row per rule.
 *
 * Shared by the editor's review dialog and the LaTeX import dialog, which show
 * the same findings at different moments — before applying them and after —
 * so this component stays neutral about tense.  The one variable bit is the
 * per-row button: pass `onApplyRule` and each auto-fixable row gets one, omit
 * it and the list is a report.
 */

interface CleanFindingsListProps {
  findings: CleanFinding[];
  /** When given, each auto-fixable row gets its own apply button. */
  onApplyRule?: (ruleId: string) => void;
  /** Shown in place of the list when there is nothing to report. */
  emptyMessage?: string;
}

const SEVERITY_CLASSES: Record<CleanFinding["severity"], string> = {
  error: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-900",
  info: "bg-slate-200 text-slate-700",
};

const SEVERITY_LABELS: Record<CleanFinding["severity"], string> = {
  error: "Error",
  warning: "Warning",
  info: "Note",
};

export default function CleanFindingsList({
  findings,
  onApplyRule,
  emptyMessage = "Nothing to clean up.",
}: CleanFindingsListProps) {
  if (findings.length === 0) {
    return (
      <p className="py-6 text-center text-slate-500 text-[0.92rem]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2 list-none m-0 p-0" data-testid="clean-findings">
      {findings.map((finding) => (
        <li
          key={finding.ruleId}
          data-testid="clean-finding"
          data-rule-id={finding.ruleId}
          className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-[2px]"
        >
          <span
            className={clsx(
              "shrink-0 px-2 py-0.5 rounded-full text-[0.72rem] font-semibold uppercase tracking-wide",
              SEVERITY_CLASSES[finding.severity],
            )}
            title={SEVERITY_LABELS[finding.severity]}
          >
            {finding.count}×
          </span>

          <div className="min-w-0 flex-1">
            <p className="m-0 text-slate-800 text-[0.92rem]">
              {finding.description}
            </p>
            {finding.examples.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1 list-none m-0 p-0">
                {finding.examples.map((example, index) => (
                  <li
                    key={`${finding.ruleId}-${index}`}
                    className="font-mono text-[0.78rem] text-slate-600 truncate"
                  >
                    {example}
                  </li>
                ))}
              </ul>
            )}
            {!finding.fixable && (
              // A `flag` rule marks appearance, not meaning: only the author
              // knows whether a `\textbf` stood for emphasis, a term, or a
              // warning, so guessing would put wrong semantics into the source.
              <p className="mt-1.5 m-0 text-slate-500 text-[0.8rem] italic">
                Needs your judgement — not changed automatically.
              </p>
            )}
          </div>

          {onApplyRule && finding.fixable && (
            <button
              type="button"
              onClick={() => onApplyRule(finding.ruleId)}
              className="shrink-0 px-2.5 py-1 text-[0.8rem] font-medium text-[#0e639c] bg-transparent border border-[#0e639c] rounded-[2px] cursor-pointer hover:bg-sky-50"
            >
              Fix
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
