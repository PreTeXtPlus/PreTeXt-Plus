import { useState, type ReactNode } from "react";
import clsx from "clsx";
import type { SourceFormat } from "../../types/editor";
import { SOURCE_FORMAT_LABELS } from "../toc/types";

/**
 * Shared building blocks for the settings drawer's per-kind panels, so the
 * division, snippet and asset settings read as one surface.
 */

export const FIELD_CONTROL_CLASSES =
  "font-[inherit] text-[0.8rem] border border-slate-300 rounded-[3px] py-1 px-2 bg-white outline-none text-slate-900 w-full box-border focus:border-blue-600 focus:shadow-[0_0_0_2px_rgba(37,99,235,0.15)] disabled:bg-slate-100 disabled:text-slate-500";

/** A labelled field: the label on the left, the control (and any note) on the right. */
export const SettingsField = ({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) => (
  <div className="grid grid-cols-[110px_1fr] items-start gap-2 text-[0.78rem]">
    <label
      htmlFor={htmlFor}
      className="font-semibold text-slate-600 pt-1 whitespace-nowrap"
    >
      {label}
    </label>
    <div className="flex flex-col gap-1 min-w-0">{children}</div>
  </div>
);

/** Small explanatory text under a field. */
export const SettingsNote = ({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning" | "error";
}) => (
  <p
    className={clsx(
      "m-0 text-[0.72rem] leading-snug",
      tone === "muted" && "text-slate-500",
      tone === "warning" && "text-amber-800 bg-amber-100 rounded py-1 px-2",
      tone === "error" && "text-red-700 bg-[#fde8e8] rounded py-1 px-2",
    )}
  >
    {children}
  </p>
);

export interface SettingsAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

/** The row of action buttons at the bottom of a panel. */
export const SettingsActions = ({ actions }: { actions: SettingsAction[] }) =>
  actions.length === 0 ? null : (
    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-200">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={clsx(
            "font-[inherit] text-[0.76rem] py-[3px] px-2.5 rounded cursor-pointer border bg-white disabled:opacity-50 disabled:cursor-default",
            action.danger
              ? "text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300"
              : "text-slate-700 border-slate-300 hover:bg-slate-100 hover:border-slate-400",
          )}
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.title}
        >
          {action.label}
        </button>
      ))}
    </div>
  );

/**
 * The code that embeds this item in a division, in whichever source format
 * the author is going to paste it into — raw `<plus:.../>` XML doesn't survive
 * Markdown or LaTeX conversion, so each format has its own spelling.
 */
export const EmbedCode = ({
  codeFor,
  defaultFormat,
}: {
  codeFor: (format: SourceFormat) => string;
  defaultFormat: SourceFormat;
}) => {
  const [format, setFormat] = useState<SourceFormat>(defaultFormat);
  const [copied, setCopied] = useState(false);
  const code = codeFor(format);
  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <SettingsField label="Embed code">
      <div className="flex items-center gap-1.5 min-w-0">
        <select
          aria-label="Embed code format"
          className={clsx(FIELD_CONTROL_CLASSES, "w-auto shrink-0")}
          value={format}
          onChange={(e) => setFormat(e.target.value as SourceFormat)}
        >
          {(Object.keys(SOURCE_FORMAT_LABELS) as SourceFormat[]).map((f) => (
            <option key={f} value={f}>
              {SOURCE_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
        <code
          data-testid="settings-embed-code"
          className="flex-1 min-w-0 font-mono text-[0.75rem] text-slate-900 bg-slate-100 border border-slate-200 rounded py-1 px-2 overflow-x-auto whitespace-nowrap"
        >
          {code}
        </code>
        <button
          type="button"
          className={clsx(
            "text-[0.75rem] py-0.5 px-2 border rounded cursor-pointer whitespace-nowrap shrink-0",
            copied
              ? "text-emerald-600 border-emerald-300 bg-emerald-50"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
          )}
          onClick={copy}
          title="Copy embed code to clipboard"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </SettingsField>
  );
};

/**
 * A text field that commits on blur or Enter rather than per keystroke — each
 * commit may persist to the host and rewrite placeholders across the project,
 * so it should happen once per edit. Escape reverts to the stored value.
 * `onCommit` returns an error message to show (keeping the draft), or nothing.
 */
export const CommitField = ({
  id,
  value,
  onCommit,
  disabled,
  placeholder,
  mono,
}: {
  id: string;
  value: string;
  onCommit: (next: string) => Promise<string | void> | string | void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
}) => {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Follow the stored value when it changes underneath (a peer's edit, or our
  // own commit landing) — but never while the author has an edit in hand.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (draft === prevValue) setDraft(value);
  }

  const commit = async () => {
    if (draft === value || busy) return;
    setBusy(true);
    try {
      const message = await onCommit(draft);
      setError(message || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this change.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        id={id}
        type="text"
        className={clsx(FIELD_CONTROL_CLASSES, mono && "font-mono")}
        value={draft}
        placeholder={placeholder}
        disabled={disabled || busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            // Revert rather than let the drawer close with a half-typed value.
            e.stopPropagation();
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error && <SettingsNote tone="error">{error}</SettingsNote>}
    </>
  );
};
