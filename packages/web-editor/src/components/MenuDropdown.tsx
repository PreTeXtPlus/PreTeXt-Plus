import { useEffect, useRef, type KeyboardEvent } from "react";
import clsx from "clsx";

/**
 * One row of a dropdown menu: an action, a rule between groups, or the label
 * that names a group.
 */
export type MenuEntry =
  | {
      kind: "item";
      key: string;
      label: string;
      onSelect: () => void;
      /** Tooltip; also what a screen reader reads as the item's description. */
      title?: string;
      /** Right-aligned shortcut hint, already formatted for this platform. */
      shortcut?: string;
      disabled?: boolean;
    }
  | { kind: "separator"; key: string }
  | { kind: "heading"; key: string; label: string };

export interface MenuDropdownProps {
  /** The menubar button's text. */
  label: string;
  entries: MenuEntry[];
  /** Open state is owned by the menubar, so only one menu is ever open. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * True while some menu in the bar is open, which is what makes hovering a
   * sibling button switch menus — the standard menubar behavior.
   */
  menubarActive?: boolean;
  /** Move to the previous/next menu in the bar (Arrow Left/Right). */
  onNavigate?: (direction: -1 | 1) => void;
}

const BUTTON_CLASSES =
  "shrink-0 py-[5px] px-2.5 border border-transparent rounded-[3px] cursor-pointer text-[13px] font-medium leading-[1.3] bg-transparent text-[#1f1f1f] transition-colors duration-150 ease-in-out hover:bg-[#e8e8e8]";

const ITEM_CLASSES =
  "flex w-full items-center gap-6 py-1.5 px-2.5 text-left bg-transparent border-none rounded cursor-pointer text-[13px] font-medium leading-[1.3] whitespace-nowrap text-[#1f1f1f] enabled:hover:bg-[#e8e8e8] enabled:focus-visible:bg-[#e8e8e8] focus:outline-none disabled:text-gray-400 disabled:cursor-not-allowed";

/**
 * A menubar menu: a button that opens a panel of actions.
 *
 * Deliberately plain — no portal, no floating-UI — because the panel hangs off
 * a toolbar pinned to the top of the editor pane, so a left-aligned absolute
 * panel is always in view. Focus moves into the panel on open so the whole
 * menu is reachable from the keyboard: Up/Down walk the items, Left/Right
 * cross to the neighbouring menu, Escape closes and hands focus back.
 */
const MenuDropdown = ({
  label,
  entries,
  isOpen,
  onOpenChange,
  menubarActive,
  onNavigate,
}: MenuDropdownProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Set when hovering across the bar opened this menu, so the click that
  // usually follows doesn't immediately toggle it back shut.
  const hoverOpenedRef = useRef(false);

  // Close on a click outside this menu. Pointer-down (not click) so the menu
  // is gone before the click lands on whatever is underneath.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointer = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [isOpen, onOpenChange]);

  // Focus the first item when the menu opens, so Up/Down work immediately.
  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.querySelector<HTMLElement>("[data-menu-item]:not(:disabled)")?.focus();
  }, [isOpen]);

  const focusItem = (offset: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(
      panel.querySelectorAll<HTMLButtonElement>("[data-menu-item]:not(:disabled)"),
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) {
      // Nothing focused yet: enter from whichever end we're heading in from.
      items[offset > 0 ? 0 : items.length - 1]?.focus();
      return;
    }
    items[(current + offset + items.length) % items.length]?.focus();
  };

  const close = (returnFocus: boolean) => {
    onOpenChange(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const handlePanelKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(-1);
        break;
      case "ArrowRight":
      case "ArrowLeft":
        if (!onNavigate) break;
        e.preventDefault();
        onNavigate(e.key === "ArrowRight" ? 1 : -1);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        // Tabbing out of a menu is a request to leave it, not to walk it.
        close(false);
        break;
    }
  };

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={clsx(BUTTON_CLASSES, isOpen && "bg-[#e0e0e0] border-[#d0d0d0]")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          if (hoverOpenedRef.current) {
            hoverOpenedRef.current = false;
            return;
          }
          onOpenChange(!isOpen);
        }}
        // Once one menu is open, sliding across the bar switches between them.
        onMouseEnter={() => {
          if (menubarActive && !isOpen) {
            hoverOpenedRef.current = true;
            onOpenChange(true);
          }
        }}
        onMouseLeave={() => {
          hoverOpenedRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !isOpen) {
            e.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        {label}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          className="absolute top-[calc(100%+4px)] left-0 z-20 flex flex-col min-w-[220px] max-h-[70vh] overflow-y-auto p-1 bg-white border border-[#d0d0d0] rounded-md shadow-[0_6px_16px_rgba(0,0,0,0.14)]"
          onKeyDown={handlePanelKeyDown}
        >
          {entries.map((entry) => {
            if (entry.kind === "separator") {
              return (
                <div
                  key={entry.key}
                  role="separator"
                  className="my-1 border-t border-[#e4e4e4]"
                />
              );
            }
            if (entry.kind === "heading") {
              return (
                <div
                  key={entry.key}
                  role="presentation"
                  className="px-2.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[#777]"
                >
                  {entry.label}
                </div>
              );
            }
            return (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                data-menu-item
                tabIndex={-1}
                className={ITEM_CLASSES}
                disabled={entry.disabled}
                title={entry.title}
                onClick={() => {
                  close(false);
                  entry.onSelect();
                }}
              >
                <span className="grow">{entry.label}</span>
                {entry.shortcut && (
                  <span className="shrink-0 text-[11px] font-normal text-[#777]">
                    {entry.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MenuDropdown;
