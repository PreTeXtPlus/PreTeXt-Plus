import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

export interface DivisionMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface DivisionMenuProps {
  items: DivisionMenuItem[];
}

/** Fixed-viewport coordinates for the portalled popup. */
interface PopupPos {
  /** Distance from the viewport right edge to the popup's right edge. */
  right: number;
  /** Set when opening downward. */
  top?: number;
  /** Set when opening upward (distance from viewport bottom to popup bottom). */
  bottom?: number;
}

const DivisionMenu = ({ items }: DivisionMenuProps) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopupPos | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // The popup is portalled and fixed-positioned, so any scroll would leave it
    // stranded — close it instead of trying to track the trigger.
    const handleScroll = () => setOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open]);

  // Position the popup against the trigger in viewport coordinates, flipping
  // above the trigger when there isn't room below. Runs after the popup mounts
  // so its measured height is available. Fixed positioning + a body portal mean
  // the popup escapes any `overflow` scroll container the trigger lives in.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = containerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;
    const triggerRect = trigger.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const openAbove = popupRect.height + 4 > spaceBelow && triggerRect.top > spaceBelow;
    setPos({
      right: Math.max(4, window.innerWidth - triggerRect.right),
      ...(openAbove
        ? { bottom: window.innerHeight - triggerRect.top + 3 }
        : { top: triggerRect.bottom + 3 }),
    });
  }, [open]);

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        className="shrink-0 py-px px-[5px] bg-transparent border border-transparent rounded-[3px] cursor-pointer text-[0.9rem] text-[#666] leading-[1.3] hover:bg-[#dde0e6] hover:border-[#b0b5c0] hover:text-[#111]"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => {
            if (!v) setPos(null);
            return !v;
          });
        }}
        aria-haspopup="true"
        aria-expanded={open}
        title="More options"
      >
        ⋮
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            className="fixed right-0 z-[1000] flex flex-col overflow-hidden min-w-[170px] bg-white border border-[#ccc] rounded-[5px] shadow-[0_4px_14px_rgba(0,0,0,0.13)]"
            style={{
              // Hidden until measured so it can't flash at the wrong spot.
              visibility: pos ? "visible" : "hidden",
              right: pos?.right,
              top: pos?.top,
              bottom: pos?.bottom,
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                className={clsx(
                  "bg-transparent border-none py-[7px] px-3 font-inherit text-[0.82rem] cursor-pointer text-left whitespace-nowrap",
                  item.danger
                    ? "text-red-700 hover:bg-red-100 hover:text-red-600"
                    : "text-[#333] hover:bg-[#e8edf8] hover:text-[#1a3a9c]",
                )}
                onClick={() => pick(item.onClick)}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};

export default DivisionMenu;
