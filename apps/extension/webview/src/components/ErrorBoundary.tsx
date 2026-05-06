import { Component, type ReactNode, type ErrorInfo } from "react";
import { getVsCodeApi } from "../vscodeApi";

/**
 * Top-level error boundary for the webview. Catches anything React's
 * render throws (e.g. the `costUsd.toFixed is not a function` crash) and
 * shows an in-place fallback instead of unmounting the whole tree to a
 * blank screen. Errors are forwarded to the extension host so they end up
 * in the "Ailancers Code" output channel — discoverable when triaging.
 *
 * Doesn't replace the host-side `outputChannel`; complements it. The host
 * already gets every WebSocket / tool-execution error logged. This catches
 * webview-only render bugs that never reach the host otherwise.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Forward to the host for the output channel + browser console for
    // immediate inspection. The host swallows unknown messages so this is
    // forward-compatible with older extension builds.
    try {
      getVsCodeApi().postMessage({
        type: "webviewError",
        message: error.message,
        stack: error.stack ?? "",
        componentStack: info.componentStack ?? "",
      });
    } catch {
      // postMessage may fail during teardown — last-ditch console log.
    }
    // Always keep a console copy for direct DevTools triage.

    console.error("[ailancers webview] render crash", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon" aria-hidden="true">⚠️</div>
          <div className="error-boundary-body">
            <div className="error-boundary-title">Ailancers Code hit a render error</div>
            <div className="error-boundary-message">{this.state.error.message}</div>
            <div className="error-boundary-hint">
              The error is in the Output panel under <strong>Ailancers Code</strong>.
              Click Reset to keep going, or reload the window if it keeps happening.
            </div>
            <div className="error-boundary-actions">
              <button type="button" className="error-boundary-btn" onClick={this.reset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
