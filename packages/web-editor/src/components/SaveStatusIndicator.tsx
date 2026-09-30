import clsx from "clsx";
import { CloudIcon } from "./icons";

/**
 * Where the host's copy of the project stands relative to its server:
 *
 * - `saved` — the server has everything.
 * - `saving` — a save is on its way.
 * - `unsaved` — there are edits the host has not sent yet.
 * - `error` — the last save failed; the edits are still only in this tab.
 * - `offline` — the connection dropped; edits wait for it to come back.
 */
export type SaveStatus = "saved" | "saving" | "unsaved" | "error" | "offline";

const STATUS_TEXT: Record<SaveStatus, { label: string; title: string }> = {
  saved: { label: "Saved", title: "All changes saved" },
  saving: { label: "Saving…", title: "Saving your latest changes…" },
  unsaved: { label: "Unsaved changes", title: "Unsaved changes" },
  error: {
    label: "Not saved",
    title: "The last save failed, so your latest changes are only in this tab",
  },
  offline: {
    label: "Reconnecting",
    title:
      "The connection dropped. Your changes will save when it returns — keep this tab open until then.",
  },
};

const STATUS_COLOR: Record<SaveStatus, string> = {
  saved: "text-gray-400",
  saving: "text-gray-400 animate-pulse",
  unsaved: "text-gray-500 hover:text-gray-800",
  error: "text-red-600 hover:text-red-700",
  offline: "text-amber-600",
};

export interface SaveStatusIndicatorProps {
  status: SaveStatus;
  /**
   * Makes the indicator a button while there is something to save
   * (`unsaved` or `error`), so an author who wants to be sure can save now.
   */
  onSaveNow?: () => void;
}

/**
 * The save state beside the title, as the host reports it: an icon, with the
 * words in its tooltip and accessible name.
 */
const SaveStatusIndicator = ({ status, onSaveNow }: SaveStatusIndicatorProps) => {
  const { label, title } = STATUS_TEXT[status];
  const shared = {
    "data-testid": "save-status",
    "data-status": status,
    "aria-label": label,
  };
  const className = clsx(
    "shrink-0 flex items-center rounded p-0.5",
    STATUS_COLOR[status],
  );

  if (onSaveNow && (status === "unsaved" || status === "error")) {
    return (
      <button
        type="button"
        {...shared}
        title={`${title} — click to ${status === "error" ? "try again" : "save now"}`}
        className={clsx(className, "cursor-pointer hover:bg-gray-100")}
        onClick={onSaveNow}
      >
        <CloudIcon status={status} />
      </button>
    );
  }
  return (
    <span role="img" {...shared} title={title} className={className}>
      <CloudIcon status={status} />
    </span>
  );
};

export default SaveStatusIndicator;
