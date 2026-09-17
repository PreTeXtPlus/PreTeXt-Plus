import type { ReactNode } from "react";
import CodeEditorMenu, { type EditorMenuActions } from "./CodeEditorMenu";
import type { CodeEditorMenuState } from "./CodeEditor";
import EditorTitleLanguageFields from "./EditorTitleLanguageFields";
import StoreFeedbackLink from "./StoreFeedbackLink";
import { buildDocumentActionEntries } from "./documentActionMenuEntries";
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

export interface TopBarProps {
  /** Rendered at the far left of the bar — e.g. the host's app logo/wordmark, linked to its home route. Falls back to a plain "✏️" when omitted. */
  logo?: ReactNode;
  /**
   * Rendered flush right, spanning the bar's full height — e.g. the host's
   * Help/Account dropdown menus.
   */
  accountArea?: ReactNode;
  /**
   * Renders in place of the editable title control when set — e.g. a host
   * with nothing to persist a title edit to.
   */
  titleOverride?: ReactNode;
  readOnly?: boolean;
  /** Collaborator presence indicator (avatar chips), when collaboration is on. */
  presence?: ReactNode;

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
 * logo, then a title/language row above a File/Edit/Insert/Tools menu row,
 * with the host's Help/Account content flush right.
 */
const TopBar = (props: TopBarProps) => {
  const state = props.menuState ?? DEFAULT_MENU_STATE;

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
    <div className="flex h-16 items-center bg-white border-b border-gray-300 max-[500px]:flex-wrap max-[500px]:h-auto">
      <div className="flex items-center shrink-0 pl-4 pr-4 max-[500px]:basis-full max-[500px]:py-2">
        {props.logo ?? <span aria-hidden>✏️</span>}
      </div>
      <div className="flex flex-1 min-w-0 flex-col justify-center gap-1 py-1.5">
        <EditorTitleLanguageFields
          readOnly={props.readOnly}
          titleOverride={props.titleOverride}
          size="large"
        />
        <div className="flex items-center w-full">
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
            showDocumentActionsInTools={false}
          />
          <div className="flex items-center gap-3 pl-2 pr-2 shrink-0">
            {props.presence}
            <StoreFeedbackLink label="Give feedback" context="main-editor" />
            {props.readOnly && (
              <span className="inline-block py-1 px-2.5 rounded-[3px] bg-[#a32899] text-white font-medium text-[13px]">
                Read-only Mode
              </span>
            )}
          </div>
        </div>
      </div>
      {props.accountArea && (
        <div className="h-16 flex items-center border-l border-gray-200 px-2 shrink-0 max-[500px]:h-auto">
          {props.accountArea}
        </div>
      )}
    </div>
  );
};

export default TopBar;
