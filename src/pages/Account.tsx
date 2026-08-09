import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useSubscription } from "../lib/subscription";
import { openBillingPortal } from "../lib/billing";

export default function Account() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user, cloudEnabled, signInWithPassword, signUp, signInWithGoogle, signOut } =
    useAuth();
  const sub = useSubscription();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const justUpgraded = params.get("upgraded") === "1";

  useEffect(() => {
    if (justUpgraded) sub.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justUpgraded]);

  const submit = async () => {
    setMsg(null);
    setBusy(true);
    const fn = mode === "signin" ? signInWithPassword : signUp;
    const { error } = await fn(email, password);
    setBusy(false);
    if (error) setMsg(error);
    else if (mode === "signup")
      setMsg("Check your email to confirm your account, then sign in.");
    else navigate(params.get("next") === "/upgrade" ? "/upgrade" : "/account");
  };

  if (user && location.pathname === "/login") {
    return <Navigate to="/account" replace />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-5 flex items-center gap-2">
        <Link to="/" className="rounded-lg p-2 text-slate-400 active:bg-slate-800" aria-label="Back">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold">Account</h1>
      </header>

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
          {justUpgraded && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              Payment received — sign in to use Pro.
            </div>
          )}
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
            className="w-full rounded-xl bg-brand py-3.5 font-semibold text-white disabled:opacity-50 active:bg-brand-dark"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="h-px flex-1 bg-slate-800" /> or{" "}
            <span className="h-px flex-1 bg-slate-800" />
          </div>
          <button
            onClick={() => signInWithGoogle()}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 font-medium text-slate-100 active:bg-slate-800"
          >
            Continue with Google
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {justUpgraded && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              Welcome to Pro! Your trial has started.
            </div>
          )}
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
              {sub.loading ? (
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
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  {sub.isPro ? `Pro · ${sub.status}` : "Free"}
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

          {sub.loading ? (
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
          ) : sub.isPro ? (
            <button
              onClick={() => openBillingPortal()}
              className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-slate-100 active:bg-slate-700"
            >
              Manage billing
            </button>
          ) : (
            <Link
              to="/upgrade"
              className="block w-full rounded-xl bg-brand py-3 text-center font-semibold text-white active:bg-brand-dark"
            >
              Upgrade to Pro
            </Link>
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
