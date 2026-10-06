import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
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

const SETTINGS_BUTTON_VARIANTS = {
  primary: "text-white bg-blue-600 border-blue-700 hover:bg-blue-700",
  default:
    "text-slate-700 bg-white border-slate-300 hover:bg-slate-100 hover:border-slate-400",
  danger:
    "text-red-700 bg-white border-red-200 hover:bg-red-50 hover:border-red-300",
};

/**
 * A settings-panel button: `primary` for a form's Save, `danger` for removal,
 * `default` for everything else.
 */
export const SettingsButton = ({
  variant = "default",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof SETTINGS_BUTTON_VARIANTS;
}) => (
  <button
    type="button"
    className={clsx(
      "font-[inherit] text-[0.76rem] py-[3px] px-2.5 rounded cursor-pointer border disabled:opacity-50 disabled:cursor-default",
      SETTINGS_BUTTON_VARIANTS[variant],
      className,
    )}
    {...rest}
  />
);

/** The row of action buttons at the bottom of a panel. */
export const SettingsActions = ({ actions }: { actions: SettingsAction[] }) =>
  actions.length === 0 ? null : (
    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-200">
      {actions.map((action) => (
        <SettingsButton
          key={action.label}
          variant={action.danger ? "danger" : "default"}
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.title}
        >
          {action.label}
        </SettingsButton>
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
  // The code gets a full-width row of its own below the label and format
  // picker: next to them it had only the label grid's value column, which a
  // long ref pushed past the drawer's edge, taking the Copy button with it.
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <SettingsField label="Embed code">
        <select
          aria-label="Embed code format"
          className={clsx(FIELD_CONTROL_CLASSES, "max-w-[200px]")}
          value={format}
          onChange={(e) => setFormat(e.target.value as SourceFormat)}
        >
          {(Object.keys(SOURCE_FORMAT_LABELS) as SourceFormat[]).map((f) => (
            <option key={f} value={f}>
              {SOURCE_FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </SettingsField>
      <div className="flex items-start gap-1.5 min-w-0">
        <code
          data-testid="settings-embed-code"
          className="flex-1 min-w-0 font-mono text-[0.75rem] text-slate-900 bg-slate-100 border border-slate-200 rounded py-1 px-2 whitespace-pre-wrap break-all"
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
    </div>
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
  autoSelect,
}: {
  id: string;
  value: string;
  onCommit: (next: string) => Promise<string | void> | string | void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
  /** Focus the field and select its text when it first appears. */
  autoSelect?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoSelect) inputRef.current?.select();
    // Only on mount: re-selecting as the author types would be hostile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        ref={inputRef}
        autoFocus={autoSelect}
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
          } else if (e.key === "Escape" && (draft !== value || error)) {
            // Revert rather than let a division's drawer close with a
            // half-typed value. With nothing to revert, Escape goes on to close
            // it (a snippet's or asset's panel stays put).
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
