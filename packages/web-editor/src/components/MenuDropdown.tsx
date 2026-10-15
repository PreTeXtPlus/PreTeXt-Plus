import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import clsx from "clsx";

/**
 * A row a submenu can hold: an action, a rule between groups, or the label
 * that names a group.
 */
export type MenuLeafEntry =
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
      /**
       * Present on an item that toggles a setting rather than performing an
       * action: it renders as a checkbox item and reads as one. Absent on an
       * ordinary action, which has no checked state to report.
       */
      checked?: boolean;
    }
  | { kind: "separator"; key: string }
  | { kind: "heading"; key: string; label: string };

/** One row of a dropdown menu: any {@link MenuLeafEntry}, or a submenu. */
export type MenuEntry =
  | MenuLeafEntry
  | {
      kind: "submenu";
      key: string;
      label: string;
      /**
       * The submenu's rows. One level only: a submenu holds no submenus, so
       * the keyboard model is a single step in and out.
       */
      entries: MenuLeafEntry[];
    };

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
  /** When true, the trigger button is disabled and the panel never opens. */
  disabled?: boolean;
  /**
   * Which edge of the trigger button the panel's own edge lines up with, and
   * which direction it grows from there. Defaults to `"left"`. Use `"right"`
   * for a menu pinned to the right edge of its container (e.g. Account),
   * where a left-aligned, rightward-growing panel would overflow the
   * viewport.
   */
  align?: "left" | "right";
  /** Shown before the label in the trigger button. */
  icon?: ReactNode;
  /**
   * When true (and `icon` is set), the label is visually hidden below the
   * compact top-bar breakpoint (52rem, see `TopBar.tsx`), leaving just the
   * icon; it still names the button for screen readers.
   */
  iconOnlyWhenCompact?: boolean;
  /**
   * Gives the trigger button a rounded gray border, setting it apart as a
   * standalone button (e.g. Account) rather than one of a row of menus.
   */
  outlined?: boolean;
}

const BUTTON_CLASSES =
  "shrink-0 py-1.5 px-3 max-[52rem]:px-2 border cursor-pointer text-sm font-medium leading-[1.3] bg-transparent text-[#1f1f1f] transition-colors duration-150 ease-in-out enabled:hover:bg-[#e8e8e8] disabled:text-gray-400 disabled:cursor-not-allowed";

const ITEM_CLASSES =
  "flex w-full items-center gap-6 py-1.5 px-2.5 text-left bg-transparent border-none rounded cursor-pointer text-[13px] font-medium leading-[1.3] whitespace-nowrap text-[#1f1f1f] enabled:hover:bg-[#e8e8e8] enabled:focus-visible:bg-[#e8e8e8] focus:outline-none disabled:text-gray-400 disabled:cursor-not-allowed";

const PANEL_CHROME =
  "p-1 bg-white border border-[#d0d0d0] rounded-md shadow-[0_6px_16px_rgba(0,0,0,0.14)]";

/**
 * How long the pointer rests on a row before an open submenu follows it. The
 * delay is what lets the pointer cut diagonally across the rows below a
 * submenu's row on its way into the submenu without switching to theirs.
 */
const SUBMENU_HOVER_DELAY_MS = 150;

/** The enabled items of `menu` itself — not those of a submenu inside it. */
const itemsOf = (menu: HTMLElement): HTMLButtonElement[] =>
  Array.from(
    menu.querySelectorAll<HTMLButtonElement>("[data-menu-item]:not(:disabled)"),
  ).filter((item) => item.closest('[role="menu"]') === menu);

/**
 * A menubar menu: a button that opens a panel of actions.
 *
 * Deliberately plain — no portal, no floating-UI — because the panel hangs off
 * a toolbar pinned to the top of the editor pane, so a simple absolute panel
 * is always in view *given the right `align`*: left-aligned (the default) for
 * a menu near the left/middle of its bar, right-aligned for one pinned to the
 * bar's right edge (see `align`) — otherwise the panel grows off-screen.
 * Focus moves into the panel on open so the whole menu is reachable from the
 * keyboard: Up/Down walk the items, Left/Right cross to the neighbouring
 * menu, Escape closes and hands focus back. See {@link MenuPanel} for
 * submenus.
 */
const MenuDropdown = ({
  label,
  entries,
  isOpen,
  onOpenChange,
  menubarActive,
  onNavigate,
  disabled,
  align = "left",
  icon,
  iconOnlyWhenCompact,
  outlined,
}: MenuDropdownProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Set when hovering across the bar opened this menu, so the click that
  // usually follows doesn't immediately toggle it back shut.
  const hoverOpenedRef = useRef(false);
  // A disabled menu never actually opens, even if a sibling's keyboard
  // navigation (Arrow Left/Right) lands on it and asks it to.
  const open = isOpen && !disabled;

  // Close on a click outside this menu. Pointer-down (not click) so the menu
  // is gone before the click lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open, onOpenChange]);

  const close = (returnFocus: boolean) => {
    onOpenChange(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  return (
    // Below the `sm` breakpoint (40rem), a left-aligned menu drops `relative`
    // so an open panel's `absolute` positioning falls through to the menubar
    // row itself (see CodeEditorMenu.tsx), anchoring it to the row's left edge
    // rather than this specific button's. A right-aligned menu (e.g. Account)
    // stays anchored to its own button at every width.
    <div
      className={clsx("relative inline-flex", align === "left" && "max-sm:static")}
      ref={containerRef}
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        className={clsx(
          BUTTON_CLASSES,
          outlined ? "rounded-md border-gray-300" : "rounded-[3px] border-transparent",
          icon != null && "inline-flex items-center gap-1.5",
          open && "bg-[#e0e0e0]",
          open && !outlined && "border-[#d0d0d0]",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (hoverOpenedRef.current) {
            hoverOpenedRef.current = false;
            return;
          }
          onOpenChange(!open);
        }}
        // Once one menu is open, sliding across the bar switches between them.
        onMouseEnter={() => {
          if (menubarActive && !open) {
            hoverOpenedRef.current = true;
            onOpenChange(true);
          }
        }}
        onMouseLeave={() => {
          hoverOpenedRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        {icon}
        {icon != null && iconOnlyWhenCompact ? (
          <span className="max-[52rem]:sr-only">{label}</span>
        ) : (
          label
        )}
      </button>

      {open && (
        <MenuPanel
          label={label}
          entries={entries}
          align={align}
          onClose={close}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};

interface MenuPanelProps {
  label: string;
  entries: MenuEntry[];
  align: "left" | "right";
  /** Close the whole menu, handing focus back to its button if asked. */
  onClose: (returnFocus: boolean) => void;
  onNavigate?: (direction: -1 | 1) => void;
}

/**
 * An open menu's panel. Mounted only while the menu is open, so which submenu
 * is open resets each time the menu closes.
 *
 * A submenu is a row that opens a panel of its own. From `sm` up it flies out
 * beside its row, on the side the menu grows towards (see `align`). Below
 * that the menu is already the width of the screen, so the submenu expands
 * inline under its row instead. From the keyboard, Right, Enter or Space on
 * the row opens it and focuses its first item; Left or Escape inside it closes
 * it and focuses the row again; Up/Down walk only the panel focus is in. Right
 * on an ordinary item still crosses to the neighbouring menu, as the WAI-ARIA
 * menubar pattern has it.
 */
const MenuPanel = ({
  label,
  entries,
  align,
  onClose,
  onNavigate,
}: MenuPanelProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  // Set when the keyboard opens a submenu, so its first item takes focus once
  // it has rendered.
  const focusSubmenuRef = useRef(false);
  // The submenu that resting the pointer on its row opened, so the click that
  // usually follows doesn't toggle it straight back shut.
  const hoverOpenedRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hasSubmenus = entries.some((entry) => entry.kind === "submenu");

  // Focus the first item on open, so Up/Down work immediately.
  useEffect(() => {
    if (panelRef.current) itemsOf(panelRef.current)[0]?.focus();
    return () => clearTimeout(hoverTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const submenu = submenuRef.current;
    if (!submenu) return;
    // A flyout that would run off the bottom of the window is lifted until it
    // fits. An inline (compact) submenu scrolls with the panel instead.
    submenu.style.top = "";
    if (getComputedStyle(submenu).position === "absolute") {
      const rect = submenu.getBoundingClientRect();
      const overflow = Math.min(
        rect.bottom - (window.innerHeight - 8),
        rect.top - 8,
      );
      if (overflow > 0) submenu.style.top = `${submenu.offsetTop - overflow}px`;
    }
    if (focusSubmenuRef.current) {
      focusSubmenuRef.current = false;
      itemsOf(submenu)[0]?.focus();
    }
  }, [openSubmenu]);

  const focusIn = (menu: HTMLElement, offset: number) => {
    const items = itemsOf(menu);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) {
      // Nothing focused yet: enter from whichever end we're heading in from.
      items[offset > 0 ? 0 : items.length - 1]?.focus();
      return;
    }
    items[(current + offset + items.length) % items.length]?.focus();
  };

  /** Open `key`'s submenu from the keyboard, focusing its first item. */
  const enterSubmenu = (key: string) => {
    clearTimeout(hoverTimerRef.current);
    if (openSubmenu === key && submenuRef.current) {
      itemsOf(submenuRef.current)[0]?.focus();
      return;
    }
    focusSubmenuRef.current = true;
    setOpenSubmenu(key);
  };

  /** Close the open submenu, handing focus back to the row that opened it. */
  const leaveSubmenu = () => {
    const row = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("[data-submenu]") ?? [],
    ).find((element) => element.dataset.submenu === openSubmenu);
    setOpenSubmenu(null);
    row?.focus();
  };

  /**
   * The pointer has come onto a top-level row: once it rests there, the open
   * submenu follows it \u2014 to the row's own submenu, or shut for an item.
   */
  const hoverRow = (e: PointerEvent, key: string | null) => {
    // A tap arrives as a click; there is no hover to act on.
    if (e.pointerType === "touch") return;
    clearTimeout(hoverTimerRef.current);
    if (key === openSubmenu) return;
    hoverTimerRef.current = setTimeout(() => {
      hoverOpenedRef.current = key;
      setOpenSubmenu(key);
    }, SUBMENU_HOVER_DELAY_MS);
  };

  const clickSubmenuRow = (key: string) => {
    clearTimeout(hoverTimerRef.current);
    if (hoverOpenedRef.current === key) {
      hoverOpenedRef.current = null;
      return;
    }
    setOpenSubmenu(openSubmenu === key ? null : key);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    const target = e.target as HTMLElement;
    const menu = target.closest<HTMLElement>('[role="menu"]') ?? panel;
    const inSubmenu = menu !== panel;
    const submenuKey = target.dataset.submenu;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusIn(menu, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusIn(menu, -1);
        break;
      case "ArrowRight":
        if (submenuKey) {
          e.preventDefault();
          enterSubmenu(submenuKey);
          break;
        }
        if (!onNavigate) break;
        e.preventDefault();
        onNavigate(1);
        break;
      case "ArrowLeft":
        if (inSubmenu) {
          e.preventDefault();
          leaveSubmenu();
          break;
        }
        if (!onNavigate) break;
        e.preventDefault();
        onNavigate(-1);
        break;
      case "Enter":
      case " ":
        // From the keyboard a submenu row opens and enters its submenu,
        // rather than toggling it the way a click does.
        if (!submenuKey) break;
        e.preventDefault();
        enterSubmenu(submenuKey);
        break;
      case "Escape":
        e.preventDefault();
        if (inSubmenu) leaveSubmenu();
        else onClose(true);
        break;
      case "Tab":
        // Tabbing out of a menu is a request to leave it, not to walk it.
        onClose(false);
        break;
    }
  };

  /**
   * One row that isn't a submenu. `topLevel` is true for a row of the panel
   * itself, whose hover the open submenu follows (see `hoverRow`).
   */
  const renderLeaf = (entry: MenuLeafEntry, topLevel: boolean) => {
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
        role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={entry.checked}
        data-menu-item
        tabIndex={-1}
        className={ITEM_CLASSES}
        disabled={entry.disabled}
        title={entry.title}
        onPointerEnter={
          topLevel && hasSubmenus ? (e) => hoverRow(e, null) : undefined
        }
        onClick={() => {
          onClose(false);
          entry.onSelect();
        }}
      >
        {entry.checked !== undefined && (
          // Always occupies its width, so a checkbox item's label sits
          // on the same left edge whether or not it is ticked.
          <span aria-hidden className="w-3 shrink-0 text-[#1f1f1f]">
            {entry.checked ? "\u2713" : ""}
          </span>
        )}
        <span className="grow">{entry.label}</span>
        {entry.shortcut && (
          <span className="shrink-0 text-[11px] font-normal text-[#777]">
            {entry.shortcut}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      className={clsx(
        "absolute top-[calc(100%+4px)] z-20 flex flex-col min-w-[220px]",
        PANEL_CHROME,
        // A scrolling panel would clip a flyout, so a panel with submenus
        // scrolls only where they expand inline instead.
        hasSubmenus
          ? "max-sm:max-h-[70vh] max-sm:overflow-y-auto"
          : "max-h-[70vh] overflow-y-auto",
        // Compact: nudge 2px off the row's left edge, shrinking to match
        // so the full-width panel doesn't overflow the viewport.
        align === "right"
          ? "right-0"
          : "left-0 w-full sm:w-auto max-sm:left-0.5 max-sm:w-[calc(100%-2px)]",
      )}
      onKeyDown={handleKeyDown}
    >
      {entries.map((entry) => {
        if (entry.kind !== "submenu") {
          return renderLeaf(entry, true);
        }
        const expanded = openSubmenu === entry.key;
        return (
          <div key={entry.key} role="none" className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={expanded}
              data-menu-item
              data-submenu={entry.key}
              tabIndex={-1}
              className={clsx(ITEM_CLASSES, expanded && "bg-[#e8e8e8]")}
              onPointerEnter={(e) => hoverRow(e, entry.key)}
              onClick={() => clickSubmenuRow(entry.key)}
            >
              <span className="grow">{entry.label}</span>
              <span
                aria-hidden
                className={clsx(
                  "shrink-0 text-[15px] leading-none text-[#777]",
                  expanded && "max-sm:rotate-90",
                )}
              >
                {"\u203a"}
              </span>
            </button>
            {expanded && (
              <div
                ref={submenuRef}
                role="menu"
                aria-label={entry.label}
                className={clsx(
                  "flex flex-col",
                  "max-sm:ml-2.5 max-sm:pl-1 max-sm:border-l max-sm:border-[#e4e4e4]",
                  // PANEL_CHROME from `sm` up — spelled out, since Tailwind
                  // only generates the class names it finds written here.
                  "sm:absolute sm:top-[-5px] sm:z-10 sm:min-w-[200px] sm:max-h-[70vh] sm:overflow-y-auto",
                  "sm:p-1 sm:bg-white sm:border sm:border-[#d0d0d0] sm:rounded-md sm:shadow-[0_6px_16px_rgba(0,0,0,0.14)]",
                  align === "right"
                    ? "sm:right-[calc(100%+4px)]"
                    : "sm:left-[calc(100%+4px)]",
                )}
                onPointerEnter={() => clearTimeout(hoverTimerRef.current)}
              >
                {entry.entries.map((child) => renderLeaf(child, false))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MenuDropdown;
