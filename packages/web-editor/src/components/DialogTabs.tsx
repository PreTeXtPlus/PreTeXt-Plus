import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { DialogTab, DialogTabBar } from "./Dialog";

export interface DialogTabItem<Id extends string = string> {
  id: Id;
  label: string;
}

export interface DialogTabsProps<Id extends string> {
  tabs: readonly DialogTabItem<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** The overflow button's text. */
  moreLabel?: string;
  className?: string;
}

/** What the overflow button is assumed to take before it has been measured. */
const MORE_WIDTH_GUESS = 80;

/**
 * A row of {@link DialogTab}s that fits its width: the tabs that fit show in
 * the bar, the rest go under a "More ▾" button at its end. The active tab is
 * always in the bar — one that would overflow takes the last visible place —
 * so the author sees which source they are on.
 *
 * Each tab's width is measured when it is rendered and remembered, since a
 * tab's label does not change; the first render shows every tab so all are
 * measured once. Where nothing can be measured (a test's DOM), every tab
 * fits.
 */
export function DialogTabs<Id extends string>({ tabs, active, onSelect, moreLabel = "More", className }: DialogTabsProps<Id>) {
  const barRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const widths = useRef(new Map<string, number>());
  const moreWidth = useRef(MORE_WIDTH_GUESS);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const measure = () => {
    const bar = barRef.current;
    if (!bar) return;
    bar.querySelectorAll<HTMLElement>("[data-tab-id]").forEach((el) => {
      if (el.offsetWidth > 0) widths.current.set(el.dataset.tabId!, el.offsetWidth);
    });
    if (moreRef.current && moreRef.current.offsetWidth > 0) moreWidth.current = moreRef.current.offsetWidth;

    const available = bar.clientWidth;
    const widthOf = (id: string) => widths.current.get(id) ?? 0;
    const total = tabs.reduce((sum, tab) => sum + widthOf(tab.id), 0);
    if (available === 0 || total <= available) {
      setVisibleCount(tabs.length);
      return;
    }
    let used = moreWidth.current;
    let count = 0;
    for (const tab of tabs) {
      if (used + widthOf(tab.id) > available) break;
      used += widthOf(tab.id);
      count += 1;
    }
    setVisibleCount(Math.max(1, count));
  };

  // Measure after each layout, and again whenever the bar's width changes.
  useLayoutEffect(measure);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(bar);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure reads refs and props on each call
  }, [tabs]);

  // Close the overflow menu on a click elsewhere or Escape.
  useEffect(() => {
    if (!isMoreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setIsMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMoreOpen]);

  const overflowing = visibleCount < tabs.length;
  let visible = tabs.slice(0, visibleCount);
  let hidden = tabs.slice(visibleCount);
  if (overflowing && !visible.some((tab) => tab.id === active)) {
    const activeTab = tabs.find((tab) => tab.id === active);
    if (activeTab) {
      const displaced = visible[visible.length - 1];
      visible = [...visible.slice(0, -1), activeTab];
      hidden = [displaced, ...hidden.filter((tab) => tab.id !== active)];
    }
  }

  return (
    <DialogTabBar ref={barRef} className={clsx("relative", className)}>
      {visible.map((tab) => (
        <DialogTab
          key={tab.id}
          data-tab-id={tab.id}
          active={tab.id === active}
          className="whitespace-nowrap"
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </DialogTab>
      ))}
      {overflowing && (
        <div className="relative ml-auto">
          <DialogTab
            ref={moreRef}
            data-testid="dialog-tabs-more"
            aria-haspopup="menu"
            aria-expanded={isMoreOpen}
            className="whitespace-nowrap"
            onClick={() => setIsMoreOpen((open) => !open)}
          >
            {moreLabel} ▾
          </DialogTab>
          {isMoreOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-0.5 min-w-[9rem] rounded border border-slate-200 bg-white py-1 shadow-md"
            >
              {hidden.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  className="block w-full border-none bg-transparent px-3 py-1.5 text-left text-[0.9rem] text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setIsMoreOpen(false);
                    onSelect(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </DialogTabBar>
  );
}

export default DialogTabs;
