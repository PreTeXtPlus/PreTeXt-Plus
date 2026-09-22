import { useState, type ReactNode } from "react";
import CodeEditorMenu, { type EditorMenuActions, type BarMenu } from "./CodeEditorMenu";
import type { MenuEntry } from "./MenuDropdown";
import type { CodeEditorMenuState } from "./CodeEditor";
import EditorTitleField from "./EditorTitleField";
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

export interface TopBarProps {
  /** Rendered at the far left of the bar — e.g. the host's app logo/wordmark, linked to its home route. Falls back to a plain "✏️" when omitted. */
  logo?: ReactNode;
  /**
   * Rendered flush right, spanning the bar's full height — e.g. the host's
   * Account dropdown menu.
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
  onOpenImport: () => void;
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

/**
 * The unified ~64px top bar for a host that wants one full-width bar in place
 * of the classic `MenuBar` + the code editor's own "Editor actions" toolbar:
 * logo, then a title row above a File/Edit/Insert/Tools/Language/Help menu
 * row, with the host's Account content flush right.
 */
const TopBar = (props: TopBarProps) => {
  const state = props.menuState ?? DEFAULT_MENU_STATE;
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
    ...(props.onSaveAndClose
      ? [
          {
            kind: "item" as const,
            key: "save-and-close",
            label: props.saveAndCloseLabel || "Save & Close",
            onSelect: props.onSaveAndClose,
          },
          { kind: "separator" as const, key: "save-and-close-sep" },
        ]
      : []),
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
  ];

  return (
    <div className="grid grid-cols-[auto_1fr_auto] min-h-20 bg-white border-b border-gray-300 [grid-template-areas:'logo_title_account'_'logo_menu_account'] max-[500px]:[grid-template-areas:'logo_title_account'_'menu_menu_menu']">
      <div className="flex items-center pl-4 pr-4 [grid-area:logo]">
        {props.logo ?? <span aria-hidden>✏️</span>}
      </div>
      <div className="flex items-center min-w-0 py-1.5 [grid-area:title]">
        <EditorTitleField
          readOnly={props.readOnly}
          titleOverride={props.titleOverride}
          size="large"
        />
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
          {props.readOnly && (
            <span className="inline-block py-1 px-2.5 rounded-[3px] bg-[#a32899] text-white font-medium text-[13px]">
              Read-only Mode
            </span>
          )}
        </div>
      </div>
      {props.accountArea && (
        <div className="flex items-center border-l border-gray-200 px-2 [grid-area:account]">
          {props.accountArea}
        </div>
      )}
    </div>
  );
};

export default TopBar;
