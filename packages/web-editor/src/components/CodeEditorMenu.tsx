import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./CodeEditorMenu.css";
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
}

/** A single toolbar action, rendered either inline or inside the overflow dropdown. */
interface MenuAction {
  key: string;
  label: string;
  onClick: () => void;
  title: string;
  className?: string;
  disabled?: boolean;
}

const GAP = 6;

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

  const renderButton = (action: MenuAction) => (
    <button
      key={action.key}
      className={`pretext-plus-editor__menu-button ${action.className ?? ""}`}
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.title}
    >
      {action.label}
    </button>
  );

  return (
    <div className="pretext-plus-editor__menu-actions" ref={containerRef}>
      {visibleActions.map(renderButton)}

      {overflowActions.length > 0 && (
        <div
          className="pretext-plus-editor__menu-dropdown"
          ref={dropdownRef}
        >
          <button
            type="button"
            className="pretext-plus-editor__menu-button"
            onClick={() => setIsOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            title="More actions"
          >
            More ▾
          </button>
          {isOpen && (
            <div className="pretext-plus-editor__menu-dropdown-list" role="menu">
              {overflowActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  className="pretext-plus-editor__menu-dropdown-item"
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
      <div className="pretext-plus-editor__menu-measure" ref={measureRef} aria-hidden>
        {actions.map((action) => (
          <button
            key={action.key}
            data-measure-btn
            className={`pretext-plus-editor__menu-button ${action.className ?? ""}`}
            tabIndex={-1}
          >
            {action.label}
          </button>
        ))}
        <button data-measure-more className="pretext-plus-editor__menu-button" tabIndex={-1}>
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
  onOpenDocinfoEditor,
  onConvertToPretext,
  canConvertToPretext,
  onOpenAssets,
  hideAssets,
  onShowFullSource,
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
  if (sourceFormat === "latex") {
    actions = [
      ...(onConvertToPretext
        ? [
            {
              key: "convert",
              label: "Convert to PreTeXt",
              onClick: onConvertToPretext,
              title: "Create a new project copy using the converted PreTeXt source",
              className: "pretext-plus-editor__menu-button--convert",
              disabled: canConvertToPretext === false,
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
              className: "pretext-plus-editor__menu-button--convert",
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
    <div className="pretext-plus-editor__code-editor-menu">
      <OverflowMenu actions={actions} />
      <span className="pretext-plus-editor__code-editor-source-badge pretext-plus-editor__code-editor-source-badge--right">
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
