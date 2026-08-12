import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  needsBillingRecovery,
  useSubscription,
} from "../lib/subscription";
import { openBillingPortal } from "../lib/billing";
import { getSafeAuthReturnPath } from "../lib/authOAuth";
import {
  getCheckoutReturnNotice,
  needsCheckoutConfirmation,
  startCheckoutConfirmationPolling,
} from "../lib/billingUi";

export default function Account() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user, cloudEnabled, signInWithPassword, signUp, signInWithGoogle, signOut } =
    useAuth();
  const userId = user?.id ?? null;
  const sub = useSubscription();
  const refreshSubscription = sub.refresh;
  const billingRecoveryNeeded = needsBillingRecovery(sub.status);
  const billingReviewNeeded =
    billingRecoveryNeeded ||
    (!sub.isPro && (sub.status === "active" || sub.status === "trialing"));

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [confirmationRun, setConfirmationRun] = useState(0);
  const [timedOutConfirmationKey, setTimedOutConfirmationKey] = useState<
    string | null
  >(null);

  const requestedNext = params.get("next");
  const directCheckoutReturn =
    location.pathname === "/account" && params.get("upgraded") === "1";
  const nestedCheckoutReturn =
    location.pathname === "/login" &&
    requestedNext === "/account?upgraded=1";
  const justUpgraded = directCheckoutReturn || nestedCheckoutReturn;
  const safeNext = getSafeAuthReturnPath(
    directCheckoutReturn ? "/account?upgraded=1" : requestedNext,
  );
  const confirmationState = {
    isPro: sub.isPro,
    status: sub.status,
    loading: sub.loading,
    error: sub.error,
  };
  const confirmationStateRef = useRef(confirmationState);
  const confirmationKey =
    justUpgraded && userId
      ? `${userId}:${location.key}:${confirmationRun}`
      : null;
  const confirmationNeeded =
    justUpgraded && Boolean(userId) && needsCheckoutConfirmation(confirmationState);
  const confirmationTimedOutActive =
    confirmationNeeded && timedOutConfirmationKey === confirmationKey;
  const confirmationPending = confirmationNeeded && !confirmationTimedOutActive;
  const checkoutReturnNotice = getCheckoutReturnNotice({
    justUpgraded,
    signedIn: Boolean(userId),
    status: sub.status,
    isPro: sub.isPro,
    loading: sub.loading,
    error: sub.error,
    timedOut: confirmationTimedOutActive,
  });

  useEffect(() => {
    confirmationStateRef.current = {
      isPro: sub.isPro,
      status: sub.status,
      loading: sub.loading,
      error: sub.error,
    };
  }, [sub.error, sub.isPro, sub.loading, sub.status]);

  useEffect(() => {
    if (!confirmationKey) return;
    return startCheckoutConfirmationPolling({
      getState: () => confirmationStateRef.current,
      refresh: refreshSubscription,
      onTimeout: () => setTimedOutConfirmationKey(confirmationKey),
    });
  }, [confirmationKey, refreshSubscription]);

  const submit = async () => {
    setMsg(null);
    setBusy(true);
    const fn = mode === "signin" ? signInWithPassword : signUp;
    const { error } = await fn(email, password);
    setBusy(false);
    if (error) setMsg(error);
    else if (mode === "signup")
      setMsg("Check your email to confirm your account, then sign in.");
    else navigate(safeNext);
  };

  const continueWithGoogle = async () => {
    setMsg(null);
    setBusy(true);
    const { error } = await signInWithGoogle(safeNext);
    if (error) {
      setMsg(error);
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setPortalError(null);
    setPortalBusy(true);
    try {
      await openBillingPortal();
    } catch (error) {
      setPortalError(
        error instanceof Error ? error.message : "Unable to open billing.",
      );
      setPortalBusy(false);
    }
  };

  const retryCheckoutConfirmation = () => {
    setConfirmationRun((current) => current + 1);
  };

  if (user && location.pathname === "/login") {
    return <Navigate to={safeNext} replace />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-5 flex items-center gap-2">
        <Link to="/" className="rounded-lg p-2 text-slate-400 active:bg-slate-800" aria-label="Back">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold">Account</h1>
      </header>

      {checkoutReturnNotice && (
        <div
          className={`mb-4 rounded-xl border p-3 text-sm ${
            checkoutReturnNotice.tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : checkoutReturnNotice.tone === "warning"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-slate-700 bg-slate-900 text-slate-300"
          }`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {checkoutReturnNotice.message}
        </div>
      )}

      {!cloudEnabled ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-300">
          <p className="font-semibold">Accounts aren't set up in this build yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            The calculators and on-device saving work without an account. Cloud
            sync and Pro require Supabase + Stripe keys to be configured.
          </p>
        </div>
      ) : !user ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              className={`seg-btn ${mode === "signin" ? "seg-btn-on" : "seg-btn-off"}`}
              onClick={() => setMode("signin")}
            >
              Sign in
            </button>
            <button
              className={`seg-btn ${mode === "signup" ? "seg-btn-on" : "seg-btn-off"}`}
              onClick={() => setMode("signup")}
            >
              Create account
            </button>
          </div>

          <label className="block">
            <span className="field-label">Email</span>
            <input
              className="field-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="block">
            <span className="field-label">Password</span>
            <input
              className="field-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          {msg && <p className="text-sm text-amber-300">{msg}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-xl bg-brand-dark py-3.5 font-semibold text-white disabled:opacity-50 active:bg-brand"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="h-px flex-1 bg-slate-800" /> or{" "}
            <span className="h-px flex-1 bg-slate-800" />
          </div>
          <button
            onClick={() => void continueWithGoogle()}
            disabled={busy}
            aria-busy={busy}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 font-medium text-slate-100 disabled:opacity-50 active:bg-slate-800"
          >
            {busy ? "Opening sign-in..." : "Continue with Google"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-sm text-slate-500">Signed in as</div>
            <div className="font-semibold">{user.email}</div>
            <div
              className="mt-3 flex items-center gap-2"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="text-sm text-slate-500">Plan:</span>
              {confirmationPending ? (
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                  Confirming...
                </span>
              ) : confirmationTimedOutActive ? (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  Awaiting confirmation
                </span>
              ) : sub.loading ? (
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                  Checking...
                </span>
              ) : sub.error ? (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  Unavailable
                </span>
              ) : (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    sub.isPro
                      ? "bg-brand/20 text-brand"
                      : billingReviewNeeded
                        ? "bg-amber-500/15 text-amber-300"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  {sub.isPro
                    ? `Pro · ${sub.status}`
                    : billingRecoveryNeeded
                      ? "Payment issue"
                      : billingReviewNeeded
                        ? "Review billing"
                      : "Free"}
                </span>
              )}
            </div>
            {sub.error && (
              <p className="mt-2 text-xs text-amber-300">
                Codewire could not verify your plan. Your device data is safe.
              </p>
            )}
            {sub.currentPeriodEnd && (
              <div className="mt-1 text-xs text-slate-500">
                Renews/ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}
              </div>
            )}
          </div>

          {confirmationPending ? (
            <button
              type="button"
              disabled
              aria-busy="true"
              className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-slate-400"
            >
              Confirming purchase...
            </button>
          ) : confirmationTimedOutActive ? (
            <button
              type="button"
              onClick={retryCheckoutConfirmation}
              className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-slate-100 outline-none active:bg-slate-700 focus-visible:ring-2 focus-visible:ring-brand"
            >
              Check plan again
            </button>
          ) : sub.loading ? (
            <button
              type="button"
              disabled
              aria-busy="true"
              className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-slate-400"
            >
              Checking plan...
            </button>
          ) : sub.error ? (
            <button
              type="button"
              onClick={sub.refresh}
              className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-slate-100 outline-none active:bg-slate-700 focus-visible:ring-2 focus-visible:ring-brand"
            >
              Check plan again
            </button>
          ) : sub.isPro || billingReviewNeeded ? (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={portalBusy}
              aria-busy={portalBusy}
              className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-slate-100 disabled:opacity-50 active:bg-slate-700"
            >
              {portalBusy
                ? "Opening billing..."
                : billingRecoveryNeeded
                  ? "Fix billing"
                  : sub.isPro
                    ? "Manage billing"
                    : "Review billing"}
            </button>
          ) : (
            <Link
              to="/upgrade"
              className="block w-full rounded-xl bg-brand-dark py-3 text-center font-semibold text-white active:bg-brand"
            >
              Upgrade to Pro
            </Link>
          )}

          {portalError && (
            <p className="text-sm text-red-400" role="alert">
              {portalError} Please try again.
            </p>
          )}

          <button
            onClick={() => signOut()}
            className="w-full rounded-xl border border-slate-800 py-3 font-medium text-slate-400 active:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
