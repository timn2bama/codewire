import { useState } from "react";
import { track } from "@vercel/analytics";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, Check, Cloud, Infinity as Inf, FileDown, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useSubscription } from "../lib/subscription";
import { openBillingPortal, startCheckout } from "../lib/billing";
import { getUpgradeBillingView } from "../lib/billingUi";

const BENEFITS = [
  { icon: Cloud, text: "Cloud sync & backup across all your devices" },
  { icon: Inf, text: "Unlimited saved jobs (free plan keeps 2)" },
  { icon: FileDown, text: "Export job reports to PDF" },
  { icon: RefreshCw, text: "NEC live code-table updates (coming soon)" },
];

export default function Upgrade() {
  const navigate = useNavigate();
  const { user, cloudEnabled } = useAuth();
  const sub = useSubscription();
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const billingView = getUpgradeBillingView({
    cloudEnabled,
    isPro: sub.isPro,
    status: sub.status,
    loading: sub.loading,
    error: sub.error,
  });

  const go = async () => {
    setError(null);
    if (!user) {
      navigate("/login?next=%2Fupgrade");
      return;
    }
    try {
      setBusy(true);
      track("start_checkout", { plan });
      await startCheckout(plan);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setError(null);
    if (!user) {
      navigate("/login?next=%2Fupgrade");
      return;
    }
    try {
      setBusy(true);
      await openBillingPortal();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const runPrimaryAction = () => {
    if (billingView.action === "checkout") {
      void go();
    } else if (billingView.action === "portal") {
      void openPortal();
    } else if (billingView.action === "refresh") {
      sub.refresh();
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <header className="mb-5 flex items-center gap-2">
        <Link to="/" className="rounded-lg p-2 text-slate-400 active:bg-slate-800" aria-label="Back">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold">Codewire Pro</h1>
      </header>

      <p className="text-slate-300">
        The calculators are always free. <strong>Pro</strong> keeps your jobs safe
        and synced, and unlocks the field workflow.
      </p>

      <div className="mt-5 space-y-3">
        {BENEFITS.map((b) => {
          const Icon = b.icon;
          return (
            <div key={b.text} className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                <Icon size={20} />
              </span>
              <span className="text-slate-200">{b.text}</span>
            </div>
          );
        })}
      </div>

      {billingView.kind === "pro" ? (
        <div className="mt-7 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
          <Check className="mx-auto mb-1 text-emerald-400" size={28} />
          <p className="font-semibold text-emerald-300">You're on Pro</p>
          <Link to="/account" className="mt-1 inline-block text-sm text-brand">
            Manage your plan →
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-7 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPlan("monthly")}
              disabled={busy || billingView.action !== "checkout"}
              aria-pressed={plan === "monthly"}
              className={`rounded-2xl border p-4 text-left ${
                plan === "monthly" ? "border-brand bg-brand/10" : "border-slate-800 bg-slate-900"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <div className="text-sm text-slate-400">Monthly</div>
              <div className="text-2xl font-bold">
                $6<span className="text-base font-normal text-slate-500">/mo</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPlan("yearly")}
              disabled={busy || billingView.action !== "checkout"}
              aria-pressed={plan === "yearly"}
              className={`relative rounded-2xl border p-4 text-left ${
                plan === "yearly" ? "border-brand bg-brand/10" : "border-slate-800 bg-slate-900"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="absolute right-2 top-2 rounded-full bg-brand-dark px-2 py-0.5 text-[10px] font-bold text-white">
                SAVE 38%
              </span>
              <div className="text-sm text-slate-400">Yearly</div>
              <div className="text-2xl font-bold">
                $45<span className="text-base font-normal text-slate-500">/yr</span>
              </div>
            </button>
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          {sub.error && billingView.kind === "error" && (
            <p className="mt-3 text-sm text-amber-300" role="status">
              Codewire could not verify your current plan. Your device data is
              safe.
            </p>
          )}

          <button
            type="button"
            onClick={runPrimaryAction}
            disabled={busy || billingView.action === "none"}
            aria-busy={busy}
            className="mt-4 w-full rounded-xl bg-brand-dark py-3.5 font-semibold text-white disabled:opacity-50 active:bg-brand"
          >
            {busy
              ? billingView.action === "portal"
                ? "Opening billing..."
                : "Opening checkout..."
              : billingView.cta}
          </button>
          <p
            className={`mt-2 text-center text-xs ${
              billingView.kind === "recovery" || billingView.kind === "error"
                ? "text-amber-300"
                : "text-slate-400"
            }`}
            role={billingView.kind === "recovery" ? "status" : undefined}
          >
            {billingView.detail}
          </p>
        </>
      )}
    </div>
  );
}
