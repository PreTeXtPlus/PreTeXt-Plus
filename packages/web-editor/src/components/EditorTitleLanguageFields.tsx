import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorStore } from "../store/hooks";
import { LANGUAGES } from "../languages";

export interface EditorTitleLanguageFieldsProps {
  /** When true, the title cannot be edited (the "edit" button is hidden). */
  readOnly?: boolean;
  /**
   * Renders in place of the editable title control when set — e.g. a host
   * that has nothing to persist a title edit to (a demo/tryit project) shows
   * a fixed label here instead.
   */
  titleOverride?: ReactNode;
  /** Slightly larger text for a host's primary title row. */
  size?: "normal" | "large";
}

/**
 * The document title (click-to-edit) and language `<select>`, shared by
 * `MenuBar` and `TopBar` so the two can never drift apart.
 */
const EditorTitleLanguageFields = ({
  readOnly,
  titleOverride,
  size = "normal",
}: EditorTitleLanguageFieldsProps) => {
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

  const titleTextClasses =
    size === "large"
      ? "font-semibold text-[1.2rem] mr-3 overflow-hidden text-ellipsis whitespace-nowrap hover:underline cursor-pointer"
      : "font-semibold text-[1.05rem] mr-3 overflow-hidden text-ellipsis whitespace-nowrap";

  return (
    <div className="flex items-center mt-4 max-[500px]:basis-full">
      {titleOverride !== undefined ? (
        <span className={titleTextClasses}>{titleOverride}</span>
      ) : editingTitle ? (
        <input
          ref={titleInputRef}
          className="w-[40vw] px-2 inline-block shadow-[0_1px_2px_0_rgba(0,0,0,0.05)] rounded-[3px] border border-gray-400 font-mono bg-white focus:outline focus:outline-2 focus:outline-blue-500 focus:outline-offset-2"
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
          <button
            type="button"
            className={titleTextClasses}
            onClick={() => !readOnly && setEditingTitle(true)}
          >
            {title || "Untitled"}
          </button>
        </span>
      )}
      <select
        className="shrink-0 py-1 px-2 rounded-[3px] border border-gray-400 bg-white text-[0.85rem] focus:outline focus:outline-2 focus:outline-blue-500 focus:outline-offset-2 disabled:bg-gray-100 disabled:text-gray-500"
        aria-label="Language"
        value={language}
        disabled={readOnly}
        onChange={(e) => updateLanguage(e.target.value)}
      >
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default EditorTitleLanguageFields;
