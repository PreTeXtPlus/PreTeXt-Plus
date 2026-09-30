import { useState, type ReactNode } from "react";
import clsx from "clsx";
import CodeEditorMenu, { type EditorMenuActions, type BarMenu } from "./CodeEditorMenu";
import type { MenuEntry } from "./MenuDropdown";
import type { CodeEditorMenuState } from "./CodeEditor";
import EditorTitleField from "./EditorTitleField";
import SaveStatusIndicator, { type SaveStatus } from "./SaveStatusIndicator";
import StoreFeedbackLink from "./StoreFeedbackLink";
import { buildDocumentActionEntries } from "./documentActionMenuEntries";
import { useEditorStore } from "../store/hooks";
import { LANGUAGES } from "../languages";
import type { SourceFormat } from "../types/editor";
import type { RootDivisionType } from "../types/sections";

const NOOP_ACTIONS: EditorMenuActions = {
  runCommand: () => {},
  cut: async () => false,
  copy: async () => false,
  paste: async () => false,
  selectAll: () => {},
  insertSnippet: () => {},
};

/** Safe defaults for before `CodeEditor` has reported its first state. */
const DEFAULT_MENU_STATE: CodeEditorMenuState = {
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  onUndo: () => {},
  onRedo: () => {},
  actions: NOOP_ACTIONS,
  isFindingInFile: false,
  switchToFindInProject: () => {},
};

/** Capabilities `TopBar` hands to a host's `accountArea` render-prop. */
export interface TopBarAccountAreaHelpers {
  /** Opens the feedback dialog. Wire to a "Give feedback" menu entry. */
  onGiveFeedback: () => void;
}

/** A labeled button the host shows at the right of the bar — see `TopBarProps.primaryAction`. */
export interface TopBarPrimaryAction {
  label: string;
  /** Tooltip saying where the button leads. */
  title?: string;
  /** Shown before the label, and in its place below the compact-viewport breakpoint. */
  icon?: ReactNode;
  onSelect: () => void;
}

export interface TopBarProps {
  /** Rendered at the far left of the bar — e.g. the host's app logo/wordmark, linked to its home route. Falls back to a plain "✏️" when omitted. */
  logo?: ReactNode;
  /**
   * Rendered flush right, spanning the bar's full height — e.g. the host's
   * Account dropdown menu. Below the compact-viewport breakpoint it sits at
   * the right of the title row, so it should shrink to fit — e.g. an
   * icon-only `MenuDropdown` (see its `iconOnlyWhenCompact`).
   */
  accountArea?: ReactNode;
  /**
   * Builds a "Help"/"Help & Feedback" menu rendered inline with
   * File/Edit/Insert/Tools/Language, sharing that row's open/keyboard-nav
   * state. Called with helpers (e.g. `onGiveFeedback`) so the host's Help
   * entries can trigger the feedback dialog this package owns. Omit for no
   * Help menu.
   */
  helpMenu?: (
    helpers: TopBarAccountAreaHelpers,
  ) => { label: string; entries: MenuEntry[] };
  /**
   * Renders in place of the editable title control when set — e.g. a host
   * with nothing to persist a title edit to.
   */
  titleOverride?: ReactNode;
  readOnly?: boolean;
  /**
   * The project's save state, shown beside the title. Omit to show none — e.g.
   * a host with nothing to persist.
   */
  saveStatus?: SaveStatus;
  /** Called from the save state while it offers to save now (unsaved changes, or a failed save). */
  onSaveNow?: () => void;
  /**
   * A labeled button at the right of the bar, before the account area: the
   * host's main way on from the editor — e.g. "Manage project" to its project
   * page. Below the compact-viewport breakpoint only its icon shows, if it has
   * one.
   */
  primaryAction?: TopBarPrimaryAction;

  // ── File menu ──────────────────────────────────────────────────────────
  /** If provided, a "Save & Close" row is shown in the File menu. */
  onSaveAndClose?: () => void;
  /** Label for the Save & Close row. Defaults to `"Save & Close"`. */
  saveAndCloseLabel?: string;

  // ── Shared with the code-editor menu (Edit/Insert/Tools + File's document actions) ──
  content: string;
  sourceFormat: SourceFormat;
  rootType?: RootDivisionType;
  onContentChange: (newContent: string) => void;
  onOpenImport?: () => void;
  onOpenClean?: () => void;
  onOpenDocinfoEditor: () => void;
  onOpenConvertToPretext?: () => void;
  canConvertToPretext?: boolean;
  onOpenAssets?: () => void;
  onOpenSnippets?: () => void;
  onShowFullSource: () => void;
  onOpenFindInProject?: () => void;
  hideAssets?: boolean;
  hideSnippets?: boolean;
  pasteAutoConvert?: boolean;
  onTogglePasteAutoConvert?: () => void;

  /** Monaco-derived reactive state reported by `CodeEditor`'s `onMenuStateChange`; `null` before its first report. */
  menuState: CodeEditorMenuState | null;
}

/*
 * Below 52rem (`max-[52rem]:` in the classes below, and in `MenuDropdown`'s
 * `iconOnlyWhenCompact` — Tailwind only sees literal class names, so the value
 * is repeated; change them together), `TopBar` reflows into two rows: the menu
 * row drops below the title, the primary action and account area stay at the
 * right of the title row and shrink to their icons.
 *
 * Set by what the one-row layout needs: logo, File…Help & Feedback, the
 * primary action and Account come to about 760px, and anything narrower slides
 * the primary action over the Help menu. The margin above that is for fonts
 * that set the menu labels wider than the ones it was measured with.
 */

/**
 * The unified ~64px top bar for a host that wants one full-width bar in place
 * of the classic `MenuBar` + the code editor's own "Editor actions" toolbar:
 * logo, then a title row (with the save state) above a
 * File/Edit/Insert/Tools/Language/Help menu row, then the host's primary action
 * and its Account content flush right.
 */
const TopBar = (props: TopBarProps) => {
  const state = props.menuState ?? DEFAULT_MENU_STATE;
  const primaryAction = props.primaryAction;
  const language = useEditorStore((s) => s.language);
  const updateLanguage = useEditorStore((s) => s.updateLanguage);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  const languageEntries: MenuEntry[] = LANGUAGES.map(({ code, label }) => ({
    kind: "item",
    key: code,
    label,
    checked: code === language,
    onSelect: () => updateLanguage(code),
  }));
  const helpMenu = props.helpMenu?.({
    onGiveFeedback: () => setIsFeedbackOpen(true),
  });
  const trailingMenus: BarMenu[] = [
    {
      key: "language",
      label: "Language",
      entries: languageEntries,
      disabled: props.readOnly,
    },
    ...(helpMenu ? [{ key: "help", ...helpMenu }] : []),
  ];

  const fileEntries = [
    ...buildDocumentActionEntries({
      content: props.content,
      sourceFormat: props.sourceFormat,
      readOnly: props.readOnly,
      onContentChange: props.onContentChange,
      onOpenImport: props.onOpenImport,
      onOpenClean: props.onOpenClean,
      onOpenDocinfoEditor: props.onOpenDocinfoEditor,
      onOpenAssets: props.onOpenAssets,
      hideAssets: props.hideAssets,
      onOpenSnippets: props.onOpenSnippets,
      hideSnippets: props.hideSnippets,
      onShowFullSource: props.onShowFullSource,
    }),
    ...(props.onSaveAndClose
      ? [
          { kind: "separator" as const, key: "save-and-close-sep" },
          {
            kind: "item" as const,
            key: "save-and-close",
            label: props.saveAndCloseLabel || "Save & Close",
            onSelect: props.onSaveAndClose,
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] min-h-16 bg-white border-b border-gray-300 [grid-template-areas:'logo_title_action_account'_'logo_menu_action_account'] max-[52rem]:[grid-template-areas:'logo_title_action_account'_'menu_menu_menu_menu']">
      <div className="flex items-center pr-1 pl-4 max-[52rem]:pl-1 [grid-area:logo]">
        {props.logo ?? <span aria-hidden>✏️</span>}
      </div>
      <div className="flex items-center min-[52rem]:pt-2 min-w-0 [grid-area:title]">
        <EditorTitleField
          readOnly={props.titleOverride != null}
          titleOverride={props.titleOverride}
        />
        {props.saveStatus && (
          <SaveStatusIndicator
            status={props.saveStatus}
            onSaveNow={props.onSaveNow}
          />
        )}
      </div>
      <div className="flex items-center w-full min-w-0 [grid-area:menu]">
        <CodeEditorMenu
          className="flex-1 border-b-0"
          content={props.content}
          sourceFormat={props.sourceFormat}
          rootType={props.rootType}
          onContentChange={props.onContentChange}
          onOpenImport={props.onOpenImport}
          pasteAutoConvert={props.pasteAutoConvert}
          onTogglePasteAutoConvert={props.onTogglePasteAutoConvert}
          onOpenClean={props.onOpenClean}
          onOpenDocinfoEditor={props.onOpenDocinfoEditor}
          onUndo={state.onUndo}
          onRedo={state.onRedo}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          hasSelection={state.hasSelection}
          actions={state.actions}
          onConvertToPretext={props.onOpenConvertToPretext}
          canConvertToPretext={props.canConvertToPretext}
          onOpenAssets={props.onOpenAssets}
          onOpenSnippets={props.onOpenSnippets}
          onOpenFindInProject={props.onOpenFindInProject}
          isFindingInFile={state.isFindingInFile}
          onSwitchToFindInProject={
            props.onOpenFindInProject ? state.switchToFindInProject : undefined
          }
          onShowFullSource={props.onShowFullSource}
          hideAssets={props.hideAssets}
          hideSnippets={props.hideSnippets}
          readOnly={props.readOnly}
          leadingMenus={[{ key: "file", label: "File", entries: fileEntries }]}
          trailingMenus={trailingMenus}
          showDocumentActionsInTools={false}
        />
        <div className="flex items-center gap-3 pl-2 pr-2 shrink-0">
          <StoreFeedbackLink
            context="main-editor"
            open={isFeedbackOpen}
            onOpenChange={setIsFeedbackOpen}
          />
        </div>
      </div>
      {primaryAction && (
        <div className="flex items-center pl-2 pr-3 max-[52rem]:pr-2 [grid-area:action]">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white cursor-pointer hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 max-[52rem]:px-2"
            title={primaryAction.title}
            onClick={primaryAction.onSelect}
          >
            {primaryAction.icon}
            <span className={clsx(primaryAction.icon != null && "max-[52rem]:sr-only")}>
              {primaryAction.label}
            </span>
          </button>
        </div>
      )}
      {props.accountArea && (
        <div className="flex items-center px-2 max-[52rem]:px-1 [grid-area:account]">
          {props.accountArea}
        </div>
      )}
    </div>
  );
};

export default TopBar;
