import type { ReactNode } from "react";
import type { Division } from "../../types/sections";
import type { ProjectMatch } from "../../types/projectScan";

export interface ScanResultsListProps {
  matches: ProjectMatch[];
  divisions: Division[];
  onSelect: (match: ProjectMatch) => void;
  /** Optional per-row controls (e.g. a single "Replace" button), shown on hover. */
  renderRowActions?: (match: ProjectMatch) => ReactNode;
  emptyMessage: string;
}

/**
 * Renders scan hits grouped by the division they were found in, using each
 * division's own title for the group header. Deliberately generic over what
 * produced the matches — findInProject today, potentially a project-wide
 * spellcheck or schema-problems scan later — since jumping to a hit and
 * grouping it by division is the same operation either way.
 */
const ScanResultsList = ({
  matches,
  divisions,
  onSelect,
  renderRowActions,
  emptyMessage,
}: ScanResultsListProps) => {
  if (matches.length === 0) {
    return <p className="px-3 py-4 text-xs text-[#888]">{emptyMessage}</p>;
  }

  const titleFor = (xmlId: string) =>
    divisions.find((d) => d.xmlId === xmlId)?.title || xmlId;

  const groups = new Map<string, ProjectMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.divisionId) ?? [];
    list.push(match);
    groups.set(match.divisionId, list);
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {[...groups.entries()].map(([divisionId, divisionMatches]) => (
        <div key={divisionId} className="border-b border-[#e5e7eb]">
          <div className="sticky top-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#666] bg-[#eef0f3]">
            {titleFor(divisionId)} · {divisionMatches.length}
          </div>
          {divisionMatches.map((match, i) => (
            <div
              key={`${match.startOffset}-${i}`}
              role="button"
              tabIndex={0}
              className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#e9ecf1]"
              onClick={() => onSelect(match)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(match);
              }}
            >
              <span
                className="min-w-0 flex-1 truncate text-[12px] font-mono text-[#444]"
                title={match.preview}
              >
                {match.preview}
              </span>
              {renderRowActions && (
                <span className="shrink-0 opacity-0 group-hover:opacity-100">
                  {renderRowActions(match)}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default ScanResultsList;
