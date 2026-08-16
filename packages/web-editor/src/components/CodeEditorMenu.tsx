import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { formatPretext } from "@pretextbook/format";
import type { SourceFormat } from "../types/editor";

interface CodeEditorMenuProps {
  /** Current source content; passed to the formatter when the user clicks "Format PreTeXt". */
  content: string;
  /** Determines which toolbar actions are available (e.g. formatting is PreTeXt-only). */
  sourceFormat: SourceFormat;
  /** Called with the formatted content after a successful format operation. */
  onContentChange: (newContent: string) => void;
  /** Called when the user clicks "Import LaTeX" to open the import dialog. */
  onOpenLatexImport: () => void;
  /**
   * If provided, a "Clean up LaTeX…" button is shown.  Opens the review dialog
   * listing the legacy markup found in this division.  Omitted for formats with
   * no legacy dialect behind them, and on a read-only buffer.
   */
  onOpenClean?: () => void;
  /** Called when the user clicks "Edit Macros" to open the docinfo editor. */
  onOpenDocinfoEditor: () => void;
  /** Triggers an undo in the Monaco editor.  Passed through from the parent. */
  onUndo: () => void;
  /** Triggers a redo in the Monaco editor.  Passed through from the parent. */
  onRedo: () => void;
  /** Whether the undo button should be enabled. */
  canUndo: boolean;
  /** Whether the redo button should be enabled. */
  canRedo: boolean;
  /**
   * If provided, a "Convert to PreTeXt" button is shown.
   * Called when the user clicks to promote the derived PreTeXt to the canonical source.
   */
  onConvertToPretext?: () => void;
  /**
   * Controls whether the "Convert to PreTeXt" button is enabled.
   * Should be `false` when conversion has failed.
   */
  canConvertToPretext?: boolean;
  /** If provided, an "Assets" button is shown (PreTeXt mode only). */
  onOpenAssets?: () => void;
  /** Called when the user clicks "Display Full Source" to open the assembled-source modal. */
  onShowFullSource: () => void;
  hideAssets?: boolean;
  /** When true, only "Display Full Source" is shown -- every editing action is hidden. */
  readOnly?: boolean;
}

/** A single toolbar action, rendered either inline or inside the overflow dropdown. */
interface MenuAction {
  key: string;
  label: string;
  onClick: () => void;
  title: string;
  variant?: "convert";
  disabled?: boolean;
}

const GAP = 6;

const MENU_BUTTON_BASE_CLASSES =
  "py-[5px] px-2.5 border rounded-[3px] cursor-pointer text-[13px] font-medium leading-[1.3] transition-colors duration-150 ease-in-out";
const MENU_BUTTON_DEFAULT_CLASSES =
  "bg-transparent text-[#1f1f1f] border-transparent enabled:hover:bg-[#e8e8e8] enabled:hover:border-[#d0d0d0] disabled:text-gray-400 disabled:cursor-not-allowed";
const MENU_BUTTON_CONVERT_CLASSES =
  "bg-blue-600 text-white border-transparent enabled:hover:bg-blue-700 disabled:bg-blue-300 disabled:text-white disabled:cursor-not-allowed";

/**
 * Renders a horizontal row of toolbar actions, collapsing the trailing ones
 * that don't fit into a "More" dropdown. Natural button widths are measured
 * once (per action set) from a hidden mirror row, then how many fit is
 * recomputed whenever the container resizes.
 */
const OverflowMenu: React.FC<{ actions: MenuAction[] }> = ({ actions }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const widthsRef = useRef<number[]>([]);
  const moreWidthRef = useRef(0);
  const [visibleCount, setVisibleCount] = useState(actions.length);
  const [isOpen, setIsOpen] = useState(false);

  // Reads only refs + container width and updates state, so it can stay stable
  // across renders — both effects below depend on this single identity.
  const recompute = useCallback(() => {
    const container = containerRef.current;
    const widths = widthsRef.current;
    if (!container || widths.length === 0) return;

    const available = container.clientWidth;
    const totalGap = widths.length > 0 ? GAP * (widths.length - 1) : 0;

    // Do all buttons fit without a "More" button?
    const fullWidth = widths.reduce((sum, w) => sum + w, 0) + totalGap;
    if (fullWidth <= available) {
      setVisibleCount(widths.length);
      return;
    }

    // Otherwise reserve room for the "More" button and fit as many as possible.
    let used = moreWidthRef.current;
    let count = 0;
    for (let i = 0; i < widths.length; i++) {
      const next = used + widths[i] + GAP;
      if (next <= available) {
        used = next;
        count++;
      } else {
        break;
      }
    }
    setVisibleCount(count);
  }, []);

  // Measure natural widths from the hidden mirror row. Keyed on a signature of
  // the action set (not the array identity, which changes every render) so this
  // only re-measures when the buttons themselves actually change.
  const signature = actions
    .map((a) => `${a.key}:${a.label}:${a.disabled ? 1 : 0}`)
    .join("|");
  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const btns = Array.from(
      measure.querySelectorAll<HTMLElement>("[data-measure-btn]"),
    );
    widthsRef.current = btns.map((b) => b.offsetWidth);
    const more = measure.querySelector<HTMLElement>("[data-measure-more]");
    moreWidthRef.current = more ? more.offsetWidth + GAP : 0;
    recompute();
  }, [signature, recompute]);

  // Recompute on container resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    return () => observer.disconnect();
  }, [recompute]);

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointer = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const visibleActions = actions.slice(0, visibleCount);
  const overflowActions = actions.slice(visibleCount);

  const actionButtonClasses = (action: MenuAction) =>
    clsx(
      MENU_BUTTON_BASE_CLASSES,
      "shrink-0 whitespace-nowrap",
      action.variant === "convert"
        ? MENU_BUTTON_CONVERT_CLASSES
        : MENU_BUTTON_DEFAULT_CLASSES,
    );

  const renderButton = (action: MenuAction) => (
    <button
      key={action.key}
      className={actionButtonClasses(action)}
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.title}
    >
      {action.label}
    </button>
  );

  return (
    <div
      className="relative flex items-center gap-1.5 flex-1 min-w-0"
      ref={containerRef}
    >
      {visibleActions.map(renderButton)}

      {overflowActions.length > 0 && (
        <div className="relative inline-flex flex-none" ref={dropdownRef}>
          <button
            type="button"
            className={clsx(MENU_BUTTON_BASE_CLASSES, MENU_BUTTON_DEFAULT_CLASSES)}
            onClick={() => setIsOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            title="More actions"
          >
            More ▾
          </button>
          {isOpen && (
            <div
              className="absolute top-[calc(100%+4px)] left-0 z-20 flex flex-col min-w-[180px] p-1 bg-white border border-[#d0d0d0] rounded-md shadow-[0_6px_16px_rgba(0,0,0,0.14)]"
              role="menu"
            >
              {overflowActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  className="block w-full py-1.5 px-2.5 text-left bg-transparent text-[#1f1f1f] rounded cursor-pointer text-[13px] font-medium leading-[1.3] whitespace-nowrap enabled:hover:bg-[#e8e8e8] disabled:text-gray-400 disabled:cursor-not-allowed"
                  onClick={() => {
                    setIsOpen(false);
                    action.onClick();
                  }}
                  disabled={action.disabled}
                  title={action.title}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hidden mirror row used only to measure natural button widths. */}
      <div
        className="absolute top-0 left-0 invisible pointer-events-none flex gap-1.5 whitespace-nowrap"
        ref={measureRef}
        aria-hidden
      >
        {actions.map((action) => (
          <button
            key={action.key}
            data-measure-btn
            className={actionButtonClasses(action)}
            tabIndex={-1}
          >
            {action.label}
          </button>
        ))}
        <button
          data-measure-more
          className={clsx(MENU_BUTTON_BASE_CLASSES, MENU_BUTTON_DEFAULT_CLASSES)}
          tabIndex={-1}
        >
          More ▾
        </button>
      </div>
    </div>
  );
};

const CodeEditorMenu: React.FC<CodeEditorMenuProps> = ({
  content,
  sourceFormat,
  onContentChange,
  onOpenLatexImport,
  onOpenClean,
  onOpenDocinfoEditor,
  onConvertToPretext,
  canConvertToPretext,
  onOpenAssets,
  hideAssets,
  onShowFullSource,
  readOnly,
}) => {
  const handleFormat = () => {
    try {
      onContentChange(formatPretext(content));
    } catch (error) {
      console.error("Error formatting:", error);
      alert("Error formatting XML");
    }
  };

  const fullSourceAction: MenuAction = {
    key: "full-source",
    label: "Display Full Source",
    onClick: onShowFullSource,
    title: "Show the full assembled PreTeXt source for the project",
  };

  let actions: MenuAction[];
  if (readOnly) {
    actions = [fullSourceAction];
  } else if (sourceFormat === "latex") {
    actions = [
      ...(onConvertToPretext
        ? [
            {
              key: "convert",
              label: "Convert to PreTeXt",
              onClick: onConvertToPretext,
              title: "Create a new project copy using the converted PreTeXt source",
              variant: "convert",
              disabled: canConvertToPretext === false,
            } satisfies MenuAction,
          ]
        : []),
      ...(onOpenClean
        ? [
            {
              key: "clean",
              label: "Clean up LaTeX…",
              onClick: onOpenClean,
              title:
                "Review LaTeX markup that does not belong in PreTeXt, and fix it",
            } satisfies MenuAction,
          ]
        : []),
      {
        key: "preamble",
        label: "Edit Preamble",
        onClick: onOpenDocinfoEditor,
        title: "Edit Preamble",
      },
      fullSourceAction,
    ];
  } else if (sourceFormat === "markdown") {
    actions = [
      ...(onConvertToPretext
        ? [
            {
              key: "convert",
              label: "Convert to PreTeXt",
              onClick: onConvertToPretext,
              title: "Create a new project copy using the converted PreTeXt source",
              variant: "convert",
              disabled: canConvertToPretext === false,
            } satisfies MenuAction,
          ]
        : []),
      {
        key: "macros",
        label: "Edit Macros",
        onClick: onOpenDocinfoEditor,
        title: "Edit Macros",
      },
      fullSourceAction,
    ];
  } else {
    actions = [
      {
        key: "format",
        label: "Format PreTeXt",
        onClick: handleFormat,
        title: "Format the PreTeXt source",
      },
      {
        key: "import-latex",
        label: "Import LaTeX",
        onClick: onOpenLatexImport,
        title: "Import LaTeX",
      },
      {
        key: "macros",
        label: "Edit Macros",
        onClick: onOpenDocinfoEditor,
        title: "Edit Macros",
      },
      ...(onOpenAssets && !hideAssets
        ? [
            {
              key: "assets",
              label: "Assets",
              onClick: onOpenAssets,
              title: "Manage assets",
            } satisfies MenuAction,
          ]
        : []),
      fullSourceAction,
    ];
  }

  return (
    <div className="flex items-center gap-1.5 py-1.5 px-2.5 w-full bg-[#f3f3f3] border-b border-[#d6d6d6]">
      <OverflowMenu actions={actions} />
      <span className="inline-flex items-center py-0.5 px-2 rounded-full bg-gray-200 text-gray-800 text-xs font-semibold ml-auto">
        {sourceFormat === "latex"
          ? "LaTeX"
          : sourceFormat === "markdown"
          ? "Markdown"
          : "PreTeXt"}
      </span>
    </div>
  );
};

export default CodeEditorMenu;
