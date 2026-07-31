import type { ReactNode } from "react";
import { useEditorStore } from "../store/hooks";
import StoreFeedbackLink from "./StoreFeedbackLink";
import "./MenuBar.css";

export interface MenuBarProps {
  /** If provided, a Save button is rendered. */
  onSaveButton?: () => void;
  /** Label for the Save button.  Defaults to `"Save"`. */
  saveButtonLabel?: string;
  /** If provided, a Cancel button is rendered. */
  onCancelButton?: () => void;
  /** Label for the Cancel button.  Defaults to `"Cancel"`. */
  cancelButtonLabel?: string;
  /** When true, the title field is read-only. */
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

  let previewModeToggle;
  if (props.showPreviewModeToggle === false) {
    previewModeToggle = null;
  } else {
    previewModeToggle = (
      <label className="pretext-plus-editor__preview-toggle">
        <input
          type="checkbox"
          checked={!showLivePreview}
          onChange={() => setShowLivePreview(!showLivePreview)}
          className="pretext-plus-editor__preview-toggle-input"
        />
        <div className="pretext-plus-editor__preview-toggle-container">
          <span className="pretext-plus-editor__preview-toggle-label">
            Simple
          </span>
          <span
            className={`pretext-plus-editor__preview-toggle-slider ${
              showLivePreview
                ? "pretext-plus-editor__preview-toggle-slider--active"
                : ""
            }`}
          >
            <span
              className={`pretext-plus-editor__preview-toggle-dot ${
                showLivePreview
                  ? "pretext-plus-editor__preview-toggle-dot--active"
                  : ""
              }`}
            ></span>
          </span>
          <span className="pretext-plus-editor__preview-toggle-label">
            Full
          </span>
        </div>
        <span className="pretext-plus-editor__preview-toggle-caption">
          Preview Mode
        </span>
        <input
          type="checkbox"
          checked={showLivePreview}
          onChange={() => setShowLivePreview(!showLivePreview)}
          className="pretext-plus-editor__preview-toggle-input"
        />
      </label>
    );
  }

  return (
    <div className="pretext-plus-editor__menu-bar">
      <div className="pretext-plus-editor__menu-left">
        <label className="pretext-plus-editor__title-label">
          Title{" "}
          <input
            className="pretext-plus-editor__title-input"
            type="text"
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            readOnly={props.readOnly}
          />
        </label>
      </div>
      <div className="pretext-plus-editor__menu-right">
        {props.presence}
        {props.onSaveButton && (
          <button
            className="pretext-plus-editor__button pretext-plus-editor__button--save"
            onClick={props.onSaveButton}
          >
            {props.saveButtonLabel || "Save"}
          </button>
        )}
        {props.onCancelButton && (
          <button
            className="pretext-plus-editor__button pretext-plus-editor__button--cancel"
            onClick={props.onCancelButton}
          >
            {props.cancelButtonLabel || "Cancel"}
          </button>
        )}
        {props.readOnly && (
          <span className="pretext-plus-editor__read-only-label">Read-only Mode</span>
        )}
        <StoreFeedbackLink label="Give feedback" context="main-editor" />
        {previewModeToggle}
      </div>
    </div>
  );
};

export default MenuBar;
