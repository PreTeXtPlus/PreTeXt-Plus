import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Rendered when a descendant throws.  Receives the error and a reset fn. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional hook for logging the caught error. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * When any value in this array changes, the boundary clears its error state
   * and retries rendering.  Pass the inputs that produced the crash (e.g. the
   * active content) so editing past a bad state automatically recovers.
   */
  resetKeys?: unknown[];
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time exceptions from descendants so a single bad input — most
 * commonly malformed XML being parsed mid-edit — degrades to an inline notice
 * instead of crashing the entire host application.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    // Surface it for debugging without taking down the app.
    console.error("ErrorBoundary caught an error:", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error === null) return;
    const { resetKeys } = this.props;
    const prevKeys = prevProps.resetKeys;
    if (
      resetKeys &&
      prevKeys &&
      (resetKeys.length !== prevKeys.length ||
        resetKeys.some((k, i) => !Object.is(k, prevKeys[i])))
    ) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error !== null) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div className="pretext-plus-editor__error-boundary" role="alert">
          <strong>Something went wrong rendering this view.</strong>
          <p className="pretext-plus-editor__error-boundary-detail">
            {error.message}
          </p>
          <button
            type="button"
            className="pretext-plus-editor__error-boundary-retry"
            onClick={this.reset}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
