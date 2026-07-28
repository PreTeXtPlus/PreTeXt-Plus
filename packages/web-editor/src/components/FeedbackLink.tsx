import { useId, useMemo, useState, type FormEvent } from "react";
import type { FeedbackSubmission, SourceFormat } from "../types/editor";
import "./dialog.css";
import "./FeedbackLink.css";

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
        className={
          className ||
          "pretext-plus-editor__feedback-trigger pretext-plus-editor__dialog-link-button"
        }
        onClick={() => setIsOpen(true)}
      >
        {label}
      </button>
      {isOpen ? (
        <div
          className="pretext-plus-editor__dialog-overlay"
          onClick={closeDialog}
        >
          <div
            className="pretext-plus-editor__dialog pretext-plus-editor__feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pretext-plus-editor__dialog-header">
              <div>
                <h2 id={titleId} className="pretext-plus-editor__dialog-title">
                  Provide Feedback
                </h2>
                <p className="pretext-plus-editor__dialog-copy">
                  Help us improve PreTeXt.plus! We'd love to hear from you.
                </p>
                <p className="pretext-plus-editor__dialog-copy">
                  (If you would like a response, please include your email
                  address in the form below and we will get back to you as soon
                  as we can.)
                </p>
              </div>
              <button
                type="button"
                className="pretext-plus-editor__dialog-close"
                onClick={closeDialog}
                aria-label="Close feedback dialog"
                disabled={isSubmitting}
              >
                Close
              </button>
            </div>

            <form
              className="pretext-plus-editor__feedback-form"
              onSubmit={handleSubmit}
            >
              <label
                className="pretext-plus-editor__feedback-label"
                htmlFor={emailId}
              >
                Email (optional)
              </label>
              <input
                id={emailId}
                type="email"
                className="pretext-plus-editor__feedback-input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />

              <label
                className="pretext-plus-editor__feedback-label"
                htmlFor={messageId}
              >
                Message
              </label>
              <textarea
                id={messageId}
                className="pretext-plus-editor__feedback-textarea"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                required
              />

              <label
                className="pretext-plus-editor__feedback-checkbox-row"
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
                <p className="pretext-plus-editor__feedback-project">
                  Project link will be included.
                </p>
              ) : (
                <p className="pretext-plus-editor__feedback-project">
                  No project link is currently available.
                </p>
              )}

              {error ? (
                <p className="pretext-plus-editor__feedback-error">{error}</p>
              ) : null}

              <div className="pretext-plus-editor__dialog-actions">
                <button
                  type="button"
                  className="pretext-plus-editor__dialog-button pretext-plus-editor__dialog-button--secondary"
                  onClick={closeDialog}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pretext-plus-editor__dialog-button"
                  disabled={isSubmitting || !message.trim()}
                >
                  {isSubmitting ? "Submitting..." : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default FeedbackLink;
