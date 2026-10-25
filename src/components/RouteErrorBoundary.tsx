import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  children: ReactNode;
  /** Changing this (the pathname) clears the error, so navigating away recovers. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render throw anywhere below it and shows an explanation instead of
 * an empty page.
 *
 * Before this, a throw during render unmounted the whole tree: the page came up
 * with no heading, no text and an empty #root, which reads to the user as the
 * app being broken with no way back. Stored calculator state reaching the
 * calculations unrepaired was one trigger (fixed in the calculators themselves);
 * a failed lazy-chunk load after a deploy is another, and that one cannot be
 * fixed at the source.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console for support; the UI shows the message only.
    console.error("[codewire] route render failed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <section
        role="alert"
        className="mx-auto w-full max-w-2xl px-4 py-10"
        data-testid="route-error"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Unexpected error
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">
          This page couldn&apos;t load
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          Something went wrong while drawing this page. Nothing you saved has
          been lost — jobs and calculations are stored on this device and in your
          account.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-dark px-4 text-sm font-semibold text-white hover:brightness-110"
          >
            Reload the page
          </button>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-100 hover:border-slate-500"
          >
            Back to all calculators
          </Link>
        </div>

        <details className="mt-6 text-sm text-slate-400">
          <summary className="cursor-pointer select-none">
            Technical details
          </summary>
          <p className="mt-2 break-words font-mono text-xs text-slate-400">
            {error.message || String(error)}
          </p>
        </details>
      </section>
    );
  }
}
