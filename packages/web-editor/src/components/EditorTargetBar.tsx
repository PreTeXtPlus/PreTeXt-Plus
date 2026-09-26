import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import type { Asset, Snippet, SourceFormat } from "../types/editor";
import { buildProjectAssetView } from "../assetView";
import { buildProjectSnippetView } from "../snippetView";
import { useEditorStore } from "../store/hooks";
import type { EditorTarget } from "./editorTarget";
import { AssetsIcon, SnippetsIcon, TocIcon } from "./toc/explorerIcons";
import { divisionDisplayTitle, TYPE_FULL_LABELS } from "./toc/types";
import { useDivisionActions } from "./toc/useDivisionActions";
import { findDivisionPlacement } from "./toc/divisionActions";
import DivisionSettings from "./settings/DivisionSettings";
import SnippetSettings from "./settings/SnippetSettings";
import AssetSettings from "./settings/AssetSettings";

export interface EditorTargetBarProps {
  /** What the code editor has open; `null` only for a project with no divisions. */
  target: EditorTarget | null;
  readOnly?: boolean;
  /** Persist a snippet metadata edit — see `SnippetSettings`' `onSave`. */
  onSaveSnippet: (snippet: Snippet, prevRef: string) => Promise<void>;
  /** Persist an asset metadata edit — see `AssetSettings`' `onSave`. */
  onSaveAsset: (asset: Asset, prevRef: string) => Promise<void>;
  /** Start replacing an asset's file; hidden when omitted. */
  onReplaceAsset?: (asset: Asset) => void;
  /** A failed autosave of the open buffer, shown until the next save succeeds. */
  saveError?: string | null;
}

const KIND_LABELS: Record<EditorTarget["kind"], string> = {
  division: "Division",
  snippet: "Snippet",
  asset: "Asset",
};

/** The explorer rail's icons, drawn at bar size. */
const KindIcon = ({ kind }: { kind: EditorTarget["kind"] }) => {
  const Icon = kind === "division" ? TocIcon : kind === "snippet" ? SnippetsIcon : AssetsIcon;
  return (
    <span
      className="inline-flex shrink-0 text-slate-500 [&>svg]:w-6 [&>svg]:h-6"
      title={KIND_LABELS[kind]}
    >
      <Icon />
    </span>
  );
};

const HamburgerIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const StatusChip = ({ children }: { children: ReactNode }) => (
  <span className="shrink-0 text-[0.66rem] font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-px whitespace-nowrap">
    {children}
  </span>
);

/**
 * The bar above the code editor: what is open (a division, snippet or asset),
 * and a hamburger that drops a drawer down over the editor with that item's
 * settings and actions. It replaces the explorer's per-row menus and the old
 * per-item edit dialogs — every item is managed from the one place it is
 * edited.
 */
const EditorTargetBar = ({
  target,
  readOnly,
  onSaveSnippet,
  onSaveAsset,
  onReplaceAsset,
  saveError,
}: EditorTargetBarProps) => {
  const isOpen = useEditorStore((s) => s.isSettingsDrawerOpen);
  const setSettingsDrawerOpen = useEditorStore((s) => s.setSettingsDrawerOpen);
  const startSectionEdit = useEditorStore((s) => s.startSectionEdit);
  const divisions = useEditorStore((s) => s.divisions);
  const projectSnippets = useEditorStore((s) => s.projectSnippets);
  const projectAssets = useEditorStore((s) => s.projectAssets);
  const { rootDivision } = useDivisionActions();
  const embedFormat: SourceFormat = rootDivision?.sourceFormat ?? "pretext";

  // Escape closes the drawer (a field that wants Escape for itself — reverting
  // a half-typed value — stops it from getting here).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsDrawerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setSettingsDrawerOpen]);

  if (!target) return null;

  // A read-only viewer can't change a division's structure, so there is
  // nothing for its drawer to hold. Snippets and assets still show their
  // (disabled) settings, which carry information — embed code, alt text.
  const canOpenDrawer = !(readOnly && target.kind === "division");

  const toggle = () => {
    if (isOpen) setSettingsDrawerOpen(false);
    // A division's drawer is its properties form, seeded from the division.
    else if (target.kind === "division") startSectionEdit(target.division);
    else setSettingsDrawerOpen(true);
  };

  let title: string;
  let id: string;
  let status: string | null = null;
  if (target.kind === "division") {
    const { division } = target;
    title =
      divisionDisplayTitle(division) ||
      `Untitled ${(TYPE_FULL_LABELS[division.type] ?? "division").toLowerCase()}`;
    id = division.xmlId;
    const placement = findDivisionPlacement(
      divisions ?? [],
      rootDivision?.xmlId ?? null,
      division.xmlId,
    );
    if (placement.kind === "unplaced") status = "not placed";
  } else if (target.kind === "snippet") {
    const { snippet } = target;
    title = snippet.ref;
    id = "";
    const row = buildProjectSnippetView(divisions, projectSnippets ?? []).find(
      (r) => r.ref === snippet.ref,
    );
    if (row && !row.inDocument) status = "not placed";
  } else {
    const { asset } = target;
    title = asset.title || asset.ref || "Untitled asset";
    id = asset.ref ?? "";
    const row = buildProjectAssetView(divisions, projectAssets ?? []).find(
      (r) => r.ref === asset.ref,
    );
    if (row && !row.inDocument) status = "not placed";
    else if (!asset.shortDescription?.trim()) status = "missing short description";
  }

  return (
    <div className="relative shrink-0 z-20">
      <div
        data-testid="editor-target-bar"
        className="flex items-center gap-2 h-9 px-2 bg-[#f5f6f8] border-b border-[#dde0e6] select-none"
      >
        <KindIcon kind={target.kind} />
        <span className="text-[0.66rem] font-bold uppercase tracking-[0.06em] text-slate-400 shrink-0">
          {KIND_LABELS[target.kind]}
        </span>
        <span
          data-testid="editor-target-title"
          className={clsx(
            "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.85rem] font-semibold text-slate-800",
            target.kind === "snippet" && "font-mono",
          )}
          title={title}
        >
          {title}
        </span>
        {id && id !== title && (
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.7rem] font-mono text-slate-400">
            {id}
          </span>
        )}
        {status && <StatusChip>{status}</StatusChip>}
        {saveError && (
          <span
            role="alert"
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.7rem] text-red-700"
            title={saveError}
          >
            Not saved: {saveError}
          </span>
        )}
        <span className="flex-1" />
        {canOpenDrawer && (
          <button
            type="button"
            data-testid="settings-drawer-toggle"
            className={clsx(
              "flex items-center justify-center w-8 h-7 p-0 border-none rounded-[3px] cursor-pointer",
              isOpen
                ? "text-slate-800 bg-slate-300"
                : "text-slate-600 bg-transparent hover:bg-slate-200",
            )}
            onClick={toggle}
            aria-expanded={isOpen}
            aria-controls="editor-settings-drawer"
            aria-label={isOpen ? "Close settings" : `${KIND_LABELS[target.kind]} settings`}
            title={isOpen ? "Close settings" : `${KIND_LABELS[target.kind]} settings`}
          >
            <HamburgerIcon />
          </button>
        )}
      </div>

      {isOpen && canOpenDrawer && (
        <div
          id="editor-settings-drawer"
          data-testid="settings-drawer"
          role="region"
          aria-label={`${KIND_LABELS[target.kind]} settings`}
          className="absolute left-0 right-0 top-full max-h-[60vh] overflow-y-auto bg-white border-b border-[#dde0e6] shadow-[0_6px_16px_rgba(0,0,0,0.12)] py-3 px-3"
        >
          <div className="max-w-[640px]">
            {target.kind === "division" && (
              <DivisionSettings
                division={target.division}
                embedFormat={embedFormat}
              />
            )}
            {target.kind === "snippet" && (
              <SnippetSettings
                // Re-seed field drafts when a different snippet opens.
                key={target.snippet.id ?? target.snippet.ref}
                snippet={target.snippet}
                embedFormat={embedFormat}
                onSave={onSaveSnippet}
                readOnly={readOnly}
              />
            )}
            {target.kind === "asset" && (
              <AssetSettings
                key={target.asset.id ?? target.asset.ref}
                asset={target.asset}
                embedFormat={embedFormat}
                onSave={onSaveAsset}
                onReplace={onReplaceAsset}
                readOnly={readOnly}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EditorTargetBar;
