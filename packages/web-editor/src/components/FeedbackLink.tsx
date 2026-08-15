import { useId, useMemo, useState, type FormEvent } from "react";
import type { FeedbackSubmission, SourceFormat } from "../types/editor";
import {
  DialogOverlay,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogCopy,
  DialogClose,
  DialogActions,
  DialogButton,
} from "./Dialog";

const FEEDBACK_TRIGGER_CLASSES =
  "border-none bg-transparent text-[#0e639c] cursor-pointer text-[0.85rem] font-semibold p-0 hover:underline";

interface FeedbackLinkProps {
  /** Link text shown where the trigger is rendered. */
  label?: string;
  /** Context string to help the host identify where feedback was submitted. */
  context: string;
  /** Called when the user submits feedback. */
  onSubmit: (submission: FeedbackSubmission) => void | Promise<void>;
  /** Optional project URL to include in the payload. */
  projectUrl?: string;
  /** Source content to include when the checkbox is enabled. */
  currentSource?: string;
  /** Source format metadata for the feedback payload. */
  sourceFormat?: SourceFormat;
  /** Optional document title metadata for the feedback payload. */
  title?: string;
  /** Optional class for the trigger button. */
  className?: string;
}

const getFallbackUrl = () => {
  if (typeof window === "undefined") {
    return undefined;
  }
  const href = window.location.href;
  return href ? href : undefined;
};

const FeedbackLink = ({
  label = "Give feedback",
  context,
  onSubmit,
  projectUrl,
  currentSource,
  sourceFormat,
  title,
  className,
}: FeedbackLinkProps) => {
  const idBase = useId();
  const titleId = `${idBase}-title`;
  const emailId = `${idBase}-email`;
  const messageId = `${idBase}-message`;
  const sourceId = `${idBase}-source`;
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [includeCurrentSource, setIncludeCurrentSource] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedProjectUrl = useMemo(() => {
    const trimmed = projectUrl?.trim();
    return trimmed || getFallbackUrl();
  }, [projectUrl]);

  const closeDialog = () => {
    setIsOpen(false);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    const trimmedEmail = email.trim();
    if (!trimmedMessage) {
      setError("Please enter a message.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const payload: FeedbackSubmission = {
        context,
        email: trimmedEmail || undefined,
        message: trimmedMessage,
        includeCurrentSource,
        currentSource: includeCurrentSource ? currentSource : undefined,
        projectUrl: resolvedProjectUrl,
        sourceFormat,
        title,
        submittedAt: new Date().toISOString(),
      };
      await onSubmit(payload);
      setMessage("");
      setIncludeCurrentSource(false);
      setIsOpen(false);
    } catch (submitError) {
      const text =
        submitError instanceof Error
          ? submitError.message
          : "Could not submit feedback.";
      setError(text);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className || FEEDBACK_TRIGGER_CLASSES}
        onClick={() => setIsOpen(true)}
      >
        {label}
      </button>
      {isOpen ? (
        <DialogOverlay onClick={closeDialog}>
          <Dialog
            className="w-[min(96%,560px)] h-auto max-h-[min(90%,640px)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <DialogHeader>
              <div>
                <DialogTitle id={titleId}>Provide Feedback</DialogTitle>
                <DialogCopy>
                  Help us improve PreTeXt.plus! We'd love to hear from you.
                </DialogCopy>
                <DialogCopy>
                  (If you would like a response, please include your email
                  address in the form below and we will get back to you as soon
                  as we can.)
                </DialogCopy>
              </div>
              <DialogClose
                onClick={closeDialog}
                aria-label="Close feedback dialog"
                disabled={isSubmitting}
              >
                Close
              </DialogClose>
            </DialogHeader>

            <form
              className="flex flex-col gap-[0.6rem] flex-1 min-h-0 overflow-y-auto"
              onSubmit={handleSubmit}
            >
              <label
                className="text-slate-700 text-[0.85rem] font-semibold"
                htmlFor={emailId}
              >
                Email (optional)
              </label>
              <input
                id={emailId}
                type="email"
                className="w-full border border-slate-300 rounded-[2px] py-2 px-[0.6rem] text-slate-900 bg-white focus:outline focus:outline-2 focus:outline-blue-300 focus:outline-offset-1"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />

              <label
                className="text-slate-700 text-[0.85rem] font-semibold"
                htmlFor={messageId}
              >
                Message
              </label>
              <textarea
                id={messageId}
                className="w-full border border-slate-300 rounded-[2px] py-2 px-[0.6rem] text-slate-900 bg-white focus:outline focus:outline-2 focus:outline-blue-300 focus:outline-offset-1 resize-y min-h-[110px]"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                required
              />

              <label
                className="inline-flex items-center gap-2 text-gray-800 text-[0.9rem]"
                htmlFor={sourceId}
              >
                <input
                  id={sourceId}
                  type="checkbox"
                  checked={includeCurrentSource}
                  onChange={(event) =>
                    setIncludeCurrentSource(event.target.checked)
                  }
                />
                Include current source
              </label>

              {resolvedProjectUrl ? (
                <p className="m-0 text-slate-500 text-[0.8rem]">
                  Project link will be included.
                </p>
              ) : (
                <p className="m-0 text-slate-500 text-[0.8rem]">
                  No project link is currently available.
                </p>
              )}

              {error ? (
                <p className="m-0 text-red-700 text-[0.85rem] font-semibold">
                  {error}
                </p>
              ) : null}

              <DialogActions>
                <DialogButton
                  variant="secondary"
                  onClick={closeDialog}
                  disabled={isSubmitting}
                >
                  Cancel
                </DialogButton>
                <DialogButton
                  type="submit"
                  disabled={isSubmitting || !message.trim()}
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
                </DialogButton>
              </DialogActions>
            </form>
          </Dialog>
        </DialogOverlay>
      ) : null}
    </>
  );
};

export default FeedbackLink;
