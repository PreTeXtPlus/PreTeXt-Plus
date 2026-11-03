/**
 * The exercise designer's form controls. Stacked label-over-control fields,
 * unlike the settings drawer's two-column `SettingsField`, since an exercise's
 * fields are mostly paragraphs of markup that want the pane's full width — but
 * built from the same control styling (`FIELD_CONTROL_CLASSES`,
 * `SettingsButton`) so the two read as one editor.
 */
import { useId, useMemo, type ReactNode, type Ref } from "react";
import clsx from "clsx";
import { FIELD_CONTROL_CLASSES, SettingsButton } from "../components/settings/settingsUi";
import { checkWellFormed } from "./serialize";

/** A label above its control, with optional help text below. */
export function Field({
  label,
  help,
  htmlFor,
  children,
}: {
  label: string;
  help?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={htmlFor} className="text-[0.76rem] font-semibold text-slate-600">
        {label}
      </label>
      {children}
      {help && <p className="m-0 text-[0.72rem] leading-snug text-slate-500">{help}</p>}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  help?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} help={help} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(FIELD_CONTROL_CLASSES, mono && "font-mono")}
      />
    </Field>
  );
}

/** A free-text field that suggests `options` — for a language, which may be any Runestone knows. */
export function SuggestInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        list={`${id}-options`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CONTROL_CLASSES}
      />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </Field>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[0.78rem] text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-blue-600"
      />
      {label}
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={FIELD_CONTROL_CLASSES}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A titled group of fields, with optional actions at the right of its heading. */
export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-1">
        <h3 className="m-0 text-[0.72rem] font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * A textarea for PreTeXt markup (or code, with `code`), flagging markup that is
 * not well-formed — which would otherwise only surface as a broken preview.
 */
export function MarkupField({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  help,
  code,
  ref,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  help?: ReactNode;
  code?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  const error = useMemo(() => (code ? null : checkWellFormed(value)), [code, value]);
  return (
    <Field label={label} help={help} htmlFor={id}>
      <textarea
        id={id}
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        spellCheck={!code}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          FIELD_CONTROL_CLASSES,
          "font-mono resize-y",
          error && "border-red-400 focus:border-red-500",
        )}
      />
      {error && <p className="m-0 text-[0.72rem] text-red-700">{error}</p>}
    </Field>
  );
}

const ICON_BUTTON =
  "bg-transparent border-0 rounded px-1.5 text-slate-500 cursor-pointer hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30 disabled:cursor-default";

/** An editable list of items with add, remove and reorder controls. */
export function ListEditor<T extends { id: string }>({
  items,
  onChange,
  create,
  addLabel,
  itemTitle,
  renderItem,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  addLabel: string;
  itemTitle: (index: number) => string;
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
}) {
  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => (
        <div key={item.id} className="rounded border border-slate-200 bg-slate-50 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[0.72rem] font-semibold text-slate-500">{itemTitle(i)}</span>
            <span className="flex gap-0.5 text-[0.8rem]">
              <button
                type="button"
                className={ICON_BUTTON}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                aria-label={`Move ${itemTitle(i)} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                disabled={i === items.length - 1}
                onClick={() => move(i, i + 1)}
                aria-label={`Move ${itemTitle(i)} down`}
              >
                ↓
              </button>
              <button
                type="button"
                className={ICON_BUTTON}
                onClick={() => onChange(items.filter((x) => x.id !== item.id))}
                aria-label={`Remove ${itemTitle(i)}`}
              >
                ✕
              </button>
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {renderItem(
              item,
              (patch) => onChange(items.map((x) => (x.id === item.id ? { ...x, ...patch } : x))),
              i,
            )}
          </div>
        </div>
      ))}
      <div>
        <SettingsButton onClick={() => onChange([...items, create()])}>+ {addLabel}</SettingsButton>
      </div>
    </div>
  );
}
