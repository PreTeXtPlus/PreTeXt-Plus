import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";

const CSRF_TOKEN = () =>
  document.querySelector('meta[name="csrf-token"]')?.content ?? "";

function FeedbackModal({
  isOpen,
  onClose,
  // pageSource / pageLatexSource / pageProjectId come from the live tracked state,
  // overridable by the feedback:open event detail
  pageSource,
  pageLatexSource,
  pageProjectId,
  openedWith,
}) {
  const source = openedWith?.source ?? pageSource ?? null;
  const latexSource = openedWith?.latexSource ?? pageLatexSource ?? null;
  const projectId = openedWith?.projectId ?? pageProjectId ?? null;
  const context = openedWith?.context ?? null;

  const hasSource = !!(source || latexSource);

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(context ?? "");
  const [includeSource, setIncludeSource] = useState(hasSource);
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [errorMessage, setErrorMessage] = useState("");

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setEmail("");
      setMessage(context ?? "");
      setIncludeSource(hasSource);
      setStatus("idle");
      setErrorMessage("");
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    setStatus("submitting");
    setErrorMessage("");

    const body = new FormData();
    body.append("message", message.trim());
    if (email.trim()) body.append("email", email.trim());
    if (includeSource && source) body.append("source_content", source);
    if (includeSource && latexSource) body.append("latex_source", latexSource);
    if (projectId) body.append("project_id", projectId);

    try {
      const response = await fetch("/feedbacks", {
        method: "POST",
        headers: {
          "X-CSRF-Token": CSRF_TOKEN(),
          "Accept": "application/json",
        },
        body,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMessage(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Network error. Please try again.");
    }
  }, [email, message, includeSource, source, latexSource, projectId]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Send Feedback</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close feedback"
          >
            ✕
          </button>
        </div>

        {status === "success" ? (
          <div className="p-6 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-gray-700 font-medium">Thanks for your feedback!</p>
            <p className="text-gray-500 text-sm mt-1">We'll review it soon.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <div>
              <label
                htmlFor="feedback-email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Your email{" "}
                <span className="text-gray-400 font-normal">(optional, if you'd like a reply)</span>
              </label>
              <input
                id="feedback-email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {email.trim() && !email.match(/\S+@\S+\.\S+/) && (
                <p className="text-yellow-600 text-xs mt-1">
                  This doesn't look like a valid email. We won't be able to reply.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="feedback-message"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Message <span className="text-red-500">*</span>
              </label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Tell us what you think, what's not working, or what you'd like to see..."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                required
              />
            </div>

            {hasSource && (
              <div className="flex items-center gap-2">
                <input
                  id="feedback-include-source"
                  type="checkbox"
                  checked={includeSource}
                  onChange={(e) => setIncludeSource(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="feedback-include-source" className="text-sm text-gray-700">
                  Include my source content to help diagnose issues
                </label>
              </div>
            )}

            {status === "error" && (
              <p className="text-red-600 text-sm">{errorMessage}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={status === "submitting" || !message.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                {status === "submitting" ? "Sending…" : "Send Feedback"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Toast({ message, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-3 py-2 shadow-lg animate-fade-in max-w-xs"
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-white/70 hover:text-white transition-colors ml-1 leading-none"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

function FeedbackWidget({ projectId: initialProjectId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [openedWith, setOpenedWith] = useState(null);
  const [toast, setToast] = useState(null); // { message }

  // Initialize from the persistent store in case the editor already fired
  // feedback:source-update before this component mounted (timing gap with async imports)
  const [pageSource, setPageSource] = useState(() => window.__feedbackPageSource?.source ?? null);
  const [pageLatexSource, setPageLatexSource] = useState(() => window.__feedbackPageSource?.latexSource ?? null);
  const [pageProjectId, setPageProjectId] = useState(() => window.__feedbackPageSource?.projectId ?? initialProjectId ?? null);

  useEffect(() => {
    const handleOpen = (e) => {
      const detail = e.detail ?? {};
      setOpenedWith({
        source: detail.source ?? null,
        latexSource: detail.latexSource ?? null,
        projectId: detail.projectId ?? null,
        context: detail.context ?? null,
      });
      setIsOpen(true);
    };

    const handleNotify = (e) => {
      const detail = e.detail ?? {};
      setToast({ message: detail.message ?? "Have feedback? Use the button below." });
    };

    const handleSourceUpdate = (e) => {
      const detail = e.detail ?? {};
      if (detail.source !== undefined) setPageSource(detail.source);
      if (detail.latexSource) setPageLatexSource(detail.latexSource); // only update if truthy
      if (detail.projectId !== undefined) setPageProjectId(detail.projectId);
    };

    window.addEventListener("feedback:open", handleOpen);
    window.addEventListener("feedback:notify", handleNotify);
    window.addEventListener("feedback:source-update", handleSourceUpdate);
    return () => {
      window.removeEventListener("feedback:open", handleOpen);
      window.removeEventListener("feedback:notify", handleNotify);
      window.removeEventListener("feedback:source-update", handleSourceUpdate);
    };
  }, []);

  const openModal = () => {
    setOpenedWith(null); // use page-tracked source
    setIsOpen(true);
  };

  return (
    <div className="flex flex-col items-end">
      {toast && (
        <Toast message={toast.message} onDismiss={() => setToast(null)} />
      )}

      <button
        type="button"
        onClick={openModal}
        className="text-xs text-gray-400 hover:text-blue-500 transition-colors underline underline-offset-2"
        aria-label="Open feedback form"
      >
        Send Feedback
      </button>

      <FeedbackModal
        isOpen={isOpen}
        onClose={() => { setIsOpen(false); setOpenedWith(null); }}
        pageSource={pageSource}
        pageLatexSource={pageLatexSource}
        pageProjectId={pageProjectId}
        openedWith={openedWith}
      />
    </div>
  );
}

let root = null;

function render(node, props = {}) {
  root = ReactDOM.createRoot(node);
  root.render(<FeedbackWidget {...props} />);
}

function destroy(node) {
  if (root) {
    root.unmount();
    root = null;
  }
}

export { render, destroy };
