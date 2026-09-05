import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useEditorStore } from "../store/hooks";
import StoreFeedbackLink from "./StoreFeedbackLink";
import { LANGUAGES } from "../languages";

export interface MenuBarProps {
  /** If provided, a Save button is rendered. */
  onSaveButton?: () => void;
  /** Label for the Save button.  Defaults to `"Save"`. */
  saveButtonLabel?: string;
  /** If provided, a Cancel button is rendered. */
  onCancelButton?: () => void;
  /** Label for the Cancel button.  Defaults to `"Cancel"`. */
  cancelButtonLabel?: string;
  /** When true, the title cannot be edited. */
  readOnly?: boolean;
  /**
   * When `false`, the Simple/Full preview mode toggle is hidden entirely.
   * Defaults to showing the toggle.
   */
  showPreviewModeToggle?: boolean;
  /** Collaborator presence indicator (avatar chips), when collaboration is on. */
  presence?: ReactNode;
}

const MenuBar = (props: MenuBarProps) => {
  const showLivePreview = useEditorStore((s) => s.showLivePreview);
  const setShowLivePreview = useEditorStore((s) => s.setShowLivePreview);
  const title = useEditorStore((s) => s.title);
  const updateTitle = useEditorStore((s) => s.updateTitle);
  const language = useEditorStore((s) => s.language);
  const updateLanguage = useEditorStore((s) => s.updateLanguage);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  let previewModeToggle;
  if (props.showPreviewModeToggle === false) {
    previewModeToggle = null;
  } else {
    previewModeToggle = (
      <label className="relative inline-flex cursor-pointer select-none flex-col">
        <input
          type="checkbox"
          checked={!showLivePreview}
          onChange={() => setShowLivePreview(!showLivePreview)}
          className="absolute w-px h-px opacity-0 [clip:rect(0,0,0,0)]"
        />
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center text-[0.875rem] font-medium w-14">
            Simple
          </span>
          <span
            className={clsx(
              "flex items-center h-[1em] w-[2em] rounded-[3px] p-1 bg-[#ccccce] transition-colors duration-200 ease-in-out",
              showLivePreview && "bg-gray-800",
            )}
          >
            <span
              className={clsx(
                "h-[0.75em] w-[0.75em] rounded-[2px] bg-white transition-transform duration-200 ease-in-out",
                showLivePreview && "translate-x-[0.8em]",
              )}
            ></span>
          </span>
          <span className="flex items-center justify-center text-[0.875rem] font-medium w-14">
            Full
          </span>
        </div>
        <span className="mt-1 text-[0.75rem] font-medium text-gray-600 text-center">
          Preview Mode
        </span>
        <input
          type="checkbox"
          checked={showLivePreview}
          onChange={() => setShowLivePreview(!showLivePreview)}
          className="absolute w-px h-px opacity-0 [clip:rect(0,0,0,0)]"
        />
      </label>
    );
  }

  return (
    <div className="flex items-center justify-between py-2 px-4 bg-gray-100 border-b border-gray-300 max-[500px]:flex-wrap max-[500px]:gap-y-3">
      <div className="flex items-center gap-4 max-[500px]:basis-full">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="w-[40vw] py-1 px-2 inline-block shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] rounded-[3px] border border-gray-400 font-mono bg-white focus:outline focus:outline-2 focus:outline-blue-500 focus:outline-offset-2"
            type="text"
            aria-label="Title"
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <span className="flex items-baseline gap-2 min-w-0 pr-4 max-[500px]:w-full">
            <span className="font-semibold text-[1.05rem] overflow-hidden text-ellipsis whitespace-nowrap">
              {title || "Untitled"}
            </span>
            {!props.readOnly && (
              <button
                type="button"
                className="shrink-0 bg-transparent border-none p-0 text-[0.8rem] text-blue-600 underline cursor-pointer hover:text-blue-700"
                onClick={() => setEditingTitle(true)}
              >
                edit
              </button>
            )}
          </span>
        )}
        <select
          className="shrink-0 py-1 px-2 rounded-[3px] border border-gray-400 bg-white text-[0.85rem] focus:outline focus:outline-2 focus:outline-blue-500 focus:outline-offset-2 disabled:bg-gray-100 disabled:text-gray-500"
          aria-label="Language"
          value={language}
          disabled={props.readOnly}
          onChange={(e) => updateLanguage(e.target.value)}
        >
          {LANGUAGES.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-4">
        {props.presence}
        {props.onSaveButton && (
          <button
            className="w-full sm:w-auto rounded-[3px] py-1 px-2.5 font-medium cursor-pointer border-none transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-60 bg-green-600 text-white hover:bg-green-700"
            onClick={props.onSaveButton}
          >
            {props.saveButtonLabel || "Save"}
          </button>
        )}
        {props.onCancelButton && (
          <button
            className="w-full sm:w-auto rounded-[3px] py-1 px-2.5 font-medium cursor-pointer border-none transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-60 bg-gray-300 text-black m-0 hover:bg-gray-400"
            onClick={props.onCancelButton}
          >
            {props.cancelButtonLabel || "Cancel"}
          </button>
        )}
        {props.readOnly && (
          <span className="inline-block py-1 px-2.5 rounded-[3px] bg-[#a32899] text-white font-medium mx-auto">
            Read-only Mode
          </span>
        )}
        <StoreFeedbackLink label="Give feedback" context="main-editor" />
        {previewModeToggle}
      </div>
    </div>
  );
};

export default MenuBar;
