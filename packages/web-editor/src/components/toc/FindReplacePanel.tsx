import { useMemo } from "react";
import { useEditorStore } from "../../store/hooks";
import { findInProject, type ProjectFindOptions } from "../projectFind";
import type { ProjectMatch } from "../../types/projectScan";
import ScanResultsList from "./ScanResultsList";

export interface FindReplacePanelProps {
  /** Hides the replace input, per-row Replace buttons, and Replace All. */
  readOnly?: boolean;
  onJumpToMatch: (match: ProjectMatch) => void;
  /** Splices `replacement` into every division touched by `matches`. */
  onReplaceMatches: (matches: ProjectMatch[], replacement: string) => void;
}

const INPUT_CLASSES =
  "w-full py-1 px-2 text-[13px] border border-[#ccd0d8] rounded-[3px] bg-white focus:outline-none focus:border-[#7aa7e0]";

/**
 * Search-and-replace across every division in the project — the sidebar
 * counterpart to Monaco's own per-division Find/Replace (`Mod+F`/`Mod+H`),
 * which only ever sees the division currently open.
 *
 * Query/replacement/options live in the store's `findPanelState` rather than
 * local `useState`: this panel only exists in the tree while the drawer is
 * open, so local state would be lost every time it's closed and reopened.
 */
const FindReplacePanel = ({
  readOnly,
  onJumpToMatch,
  onReplaceMatches,
}: FindReplacePanelProps) => {
  const divisions = useEditorStore((s) => s.divisions) ?? [];
  const { query, replacement, matchCase, wholeWord, useRegex } = useEditorStore(
    (s) => s.findPanelState,
  );
  const setFindPanelState = useEditorStore((s) => s.setFindPanelState);

  const options: ProjectFindOptions = { matchCase, wholeWord, useRegex };
  const matches = useMemo(
    () => findInProject(divisions, query, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [divisions, query, matchCase, wholeWord, useRegex],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col gap-1.5 p-2 border-b border-[#dde0e6] shrink-0">
        <input
          type="text"
          className={INPUT_CLASSES}
          placeholder="Find in project"
          value={query}
          onChange={(e) => setFindPanelState({ query: e.target.value })}
          aria-label="Find in project"
          autoFocus
        />
        {!readOnly && (
          <input
            type="text"
            className={INPUT_CLASSES}
            placeholder="Replace with"
            value={replacement}
            onChange={(e) => setFindPanelState({ replacement: e.target.value })}
            aria-label="Replace with"
          />
        )}
        <div className="flex items-center gap-3 text-[11px] text-[#555]">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setFindPanelState({ matchCase: e.target.checked })}
            />
            Match case
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setFindPanelState({ wholeWord: e.target.checked })}
            />
            Whole word
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={useRegex}
              onChange={(e) => setFindPanelState({ useRegex: e.target.checked })}
            />
            Regex
          </label>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#777]">
            {query
              ? `${matches.length} result${matches.length === 1 ? "" : "s"}`
              : " "}
          </span>
          {!readOnly && (
            <button
              type="button"
              className="py-1 px-2 text-[12px] font-medium rounded-[3px] bg-blue-600 text-white enabled:hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
              disabled={matches.length === 0}
              onClick={() => onReplaceMatches(matches, replacement)}
            >
              Replace All
            </button>
          )}
        </div>
      </div>
      <ScanResultsList
        matches={matches}
        divisions={divisions}
        onSelect={onJumpToMatch}
        emptyMessage={
          query ? "No matches" : "Type to search across every division"
        }
        renderRowActions={
          readOnly
            ? undefined
            : (match) => (
                <button
                  type="button"
                  className="text-[11px] px-1.5 py-0.5 rounded-[3px] border border-[#ccd0d8] bg-white hover:bg-[#f0f2f5]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReplaceMatches([match], replacement);
                  }}
                >
                  Replace
                </button>
              )
        }
      />
    </div>
  );
};

export default FindReplacePanel;
