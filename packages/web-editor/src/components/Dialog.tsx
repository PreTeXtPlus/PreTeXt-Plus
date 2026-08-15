import clsx from "clsx";
import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  ElementType,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
} from "react";

// Shared chrome reused across the editor's modal dialogs (asset manager,
// docinfo, full-source, convert-to-PreTeXt, feedback, LaTeX import). Each
// component here is a 1:1 translation of a class previously defined in
// dialog.css; the wrapper accepts a `className` prop (merged via clsx) so
// call sites can still layer on component-specific styling.

export function DialogOverlay({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "absolute inset-0 z-[2000] flex items-center justify-center py-[2vh] px-[2vw] bg-slate-900/76",
        className
      )}
      {...rest}
    />
  );
}

interface DialogProps extends HTMLAttributes<HTMLDivElement> {
  commonMode?: boolean;
}

export function Dialog({ className, commonMode, ...rest }: DialogProps) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-4 w-[min(96%,1400px)] h-[min(92%,1000px)] p-5 rounded-[2px] bg-slate-50 shadow-[0_25px_80px_rgba(15,23,42,0.35)] overflow-hidden",
        "max-[700px]:w-[98%] max-[700px]:h-[96%] max-[700px]:p-4",
        "[@media(max-height:600px)]:h-[98%] [@media(max-height:600px)]:p-3 [@media(max-height:600px)]:gap-2",
        commonMode && "border-2 border-sky-900",
        className
      )}
      {...rest}
    />
  );
}

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  single?: boolean;
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  function DialogContent({ className, single, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={clsx(
          "flex-1 min-h-0 overflow-y-auto grid gap-4 max-[700px]:grid-cols-1",
          single ? "grid-cols-1" : "grid-cols-2",
          className
        )}
        {...rest}
      />
    );
  }
);

export function DialogHeader({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "flex items-start justify-between gap-4 shrink-0 max-[700px]:flex-col",
        className
      )}
      {...rest}
    />
  );
}

export function DialogTitle({
  className,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={clsx(
        "m-0 text-slate-900 text-[1.4rem] [@media(max-height:600px)]:text-[1.15rem]",
        className
      )}
      {...rest}
    />
  );
}

export function DialogCopy({
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={clsx(
        "mt-[0.4rem] mb-0 text-slate-600 max-w-[70ch] [@media(max-height:600px)]:text-[0.82rem]",
        className
      )}
      {...rest}
    />
  );
}

export function DialogClose({
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={clsx(
        "border-none bg-transparent text-slate-700 cursor-pointer text-[0.95rem] font-semibold max-[700px]:self-end",
        className
      )}
      {...rest}
    />
  );
}

export function DialogTabBar({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "flex gap-0 border-b-2 border-slate-200 shrink-0",
        className
      )}
      {...rest}
    />
  );
}

interface DialogTabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function DialogTab({
  className,
  active,
  type = "button",
  ...rest
}: DialogTabProps) {
  return (
    <button
      type={type}
      className={clsx(
        "px-4 py-1.5 border-none border-b-2 border-transparent -mb-0.5 bg-transparent text-slate-500 cursor-pointer text-[0.9rem] font-medium hover:text-slate-900",
        active && "text-[#0e639c] border-b-[#0e639c] font-semibold",
        className
      )}
      {...rest}
    />
  );
}

export function DialogSection({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("min-h-0 flex flex-col gap-2", className)} {...rest} />
  );
}

export function DialogLabelRow({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("flex items-center justify-between", className)}
      {...rest}
    />
  );
}

export function DialogLabel({
  className,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={clsx(
        "text-slate-700 text-[0.85rem] font-semibold",
        className
      )}
      {...rest}
    />
  );
}

interface DialogHelperCopyProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
}

export function DialogHelperCopy({
  className,
  as: Tag = "span",
  ...rest
}: DialogHelperCopyProps) {
  return (
    <Tag
      className={clsx(
        "m-0 text-slate-500 text-[0.78rem] font-normal block",
        className
      )}
      {...rest}
    />
  );
}

export function DialogLinkButton({
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={clsx(
        "border-none bg-transparent text-[#0e639c] cursor-pointer text-[0.85rem] font-semibold p-0 hover:underline",
        className
      )}
      {...rest}
    />
  );
}

export const DialogFileInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function DialogFileInput({ className, type = "file", ...rest }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={clsx("hidden", className)}
      {...rest}
    />
  );
});

export function DialogStatus({
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <span
      className={clsx("text-teal-700 text-[0.8rem] font-semibold", className)}
      {...rest}
    />
  );
}

export function DialogCommonModeBanner({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "border border-sky-900 bg-cyan-50 text-cyan-900 py-[0.65rem] px-[0.8rem] rounded-[2px] text-[0.9rem] font-semibold",
        className
      )}
      {...rest}
    />
  );
}

export function DialogCheckboxRow({
  className,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={clsx(
        "mt-3 inline-flex items-center gap-[0.45rem] text-slate-700 text-[0.92rem]",
        className
      )}
      {...rest}
    />
  );
}

interface DialogEditorPaneProps extends HTMLAttributes<HTMLDivElement> {
  dragActive?: boolean;
}

export function DialogEditorPane({
  className,
  dragActive,
  ...rest
}: DialogEditorPaneProps) {
  return (
    <div
      className={clsx(
        "flex-1 w-full min-h-[140px] border border-slate-300 rounded-[0.2px] overflow-hidden bg-white",
        dragActive && "border-[#0e639c] bg-sky-50",
        className
      )}
      {...rest}
    />
  );
}

export function DialogActions({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("flex justify-end gap-3 shrink-0", className)}
      {...rest}
    />
  );
}

interface DialogButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

const dialogButtonVariantClasses: Record<
  NonNullable<DialogButtonProps["variant"]>,
  string
> = {
  primary: "bg-[#0e639c] enabled:hover:bg-[#1177bb]",
  secondary: "bg-gray-500 enabled:hover:bg-gray-600",
  danger: "bg-red-700 enabled:hover:bg-red-800",
};

export function DialogButton({
  className,
  variant = "primary",
  type = "button",
  ...rest
}: DialogButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        "px-4 py-1.5 text-white border-none rounded-[2px] cursor-pointer text-sm font-medium disabled:bg-[#555] disabled:cursor-not-allowed disabled:opacity-50",
        dialogButtonVariantClasses[variant],
        className
      )}
      {...rest}
    />
  );
}
