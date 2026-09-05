import { useEffect } from "react";
import FindReplacePanel from "./FindReplacePanel";
import type { ProjectMatch } from "../../types/projectScan";

export interface FindReplaceDrawerProps {
  onClose: () => void;
  onJumpToMatch: (match: ProjectMatch) => void;
  onReplaceMatches: (matches: ProjectMatch[], replacement: string) => void;
  readOnly?: boolean;
}

/**
 * Project-wide find/replace, opened from the Tools menu. A docked panel in
 * normal flex flow next to the TOC (not an absolutely-positioned overlay) —
 * that way it can never cover the code editor, regardless of whether the TOC
 * itself is collapsed or expanded. It's independent of the TOC's own collapse
 * state either way, and closes with its own ✕/Escape.
 */
const FindReplaceDrawer = ({
  onClose,
  onJumpToMatch,
  onReplaceMatches,
  readOnly,
}: FindReplaceDrawerProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="flex flex-col w-[300px] min-w-[300px] h-full bg-white border-r border-[#dde0e6] shrink-0">
      <div className="flex items-center justify-between py-2 px-2.5 pb-1.5 border-b border-[#dde0e6] shrink-0">
        <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#555]">
          Find in Project
        </span>
        <button
          type="button"
          className="shrink-0 py-0.5 px-1 bg-transparent border-none rounded-[3px] cursor-pointer text-base leading-none text-[#666] hover:bg-[#e3e6ec] hover:text-[#333]"
          onClick={onClose}
          aria-label="Close find panel"
          title="Close find panel"
        >
          ✕
        </button>
      </div>
      <FindReplacePanel
        readOnly={readOnly}
        onJumpToMatch={onJumpToMatch}
        onReplaceMatches={onReplaceMatches}
      />
    </div>
  );
};

export default FindReplaceDrawer;
