import { useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  Download,
  HardDrive,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  claimUnassignedLocalData,
  useUnclaimedLocalData,
} from "../lib/jobs";
import {
  backupFilename,
  createBackup,
  MAX_BACKUP_BYTES,
  mergeBackup,
  parseBackup,
  serializeBackup,
  summarizeBackup,
  type CodewireBackup,
} from "../lib/dataBackup";
import { useSubscription } from "../lib/subscription";
import { useSyncStatus } from "../lib/syncStatus";

export function SyncAndBackupPanel() {
  const { user } = useAuth();
  return <SyncAndBackupPanelForScope key={user?.id ?? "guest"} />;
}

function SyncAndBackupPanelForScope() {
  const { user, cloudEnabled, loading: authLoading } = useAuth();
  const subscription = useSubscription();
  const { isPro } = subscription;
  const sync = useSyncStatus();
  const unclaimed = useUnclaimedLocalData();
  const inputRef = useRef<HTMLInputElement>(null);
  const claimTriggerRef = useRef<HTMLButtonElement>(null);
  const claimFeedbackRef = useRef<HTMLParagraphElement>(null);
  const backupFeedbackRef = useRef<HTMLParagraphElement>(null);
  const scopeKey = user?.id ?? "guest";
  const [pending, setPending] = useState<{
    backup: CodewireBackup;
    scopeKey: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [confirmClaim, setConfirmClaim] = useState(false);
  const [claimFeedback, setClaimFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const cloudEligible = Boolean(cloudEnabled && user && isPro);
  const status = getStatusCopy(
    cloudEligible,
    Boolean(user),
    isPro,
    subscription.loading,
    subscription.error,
    authLoading,
    sync,
  );

  const exportBackup = () => {
    try {
      const backup = createBackup();
      const blob = new Blob([serializeBackup(backup)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backupFilename(backup.exportedAt);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setFeedback({ kind: "success", text: "Backup prepared." });
    } catch {
      setFeedback({
        kind: "error",
        text: "Codewire could not create a valid backup from this device.",
      });
    }
  };

  const inspectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setPending(null);
    setFeedback(null);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setFeedback({
        kind: "error",
        text: "This backup is larger than the 10 MB import limit.",
      });
      input.value = "";
      return;
    }
    setReadingFile(true);
    const targetScope = scopeKey;
    try {
      const backup = parseBackup(await file.text());
      setPending({
        backup,
        scopeKey: targetScope,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "This backup could not be read.",
      });
      input.value = "";
    } finally {
      setReadingFile(false);
    }
  };

  const confirmMerge = () => {
    if (!pending) return;
    if (pending.scopeKey !== scopeKey) {
      setPending(null);
      setFeedback({
        kind: "error",
        text: "The account changed. Select the backup again before merging.",
      });
      return;
    }
    try {
      const result = mergeBackup(pending.backup);
      const changedJobs =
        result.jobsAdded + result.jobsUpdated + result.jobsRestored;
      const changedCalcs =
        result.calcsAdded + result.calcsUpdated + result.calcsRestored;
      const skipped = result.jobsSkipped + result.calcsSkipped;
      setFeedback({
        kind: "success",
        text:
          changedJobs + changedCalcs === 0
            ? "No changes were needed; this device already has the same or newer data."
            : `Recovered ${changedJobs} ${
                changedJobs === 1 ? "job" : "jobs"
              } and ${changedCalcs} saved ${
                changedCalcs === 1 ? "calculation" : "calculations"
              }.${
                skipped ? ` Kept ${skipped} newer device items.` : ""
              }`,
      });
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
      window.requestAnimationFrame(() => backupFeedbackRef.current?.focus());
    } catch {
      setFeedback({
        kind: "error",
        text: "The backup was valid, but this device could not save it.",
      });
    }
  };

  const StatusIcon = status.icon;
  const pendingSummary = pending ? summarizeBackup(pending.backup) : null;
  const visibleUnclaimed = user ? unclaimed : null;

  const claimDeviceData = async () => {
    setClaiming(true);
    try {
      const changed = await claimUnassignedLocalData();
      setConfirmClaim(false);
      setClaimFeedback({
        kind: "success",
        text: changed
          ? "Active unassigned device data was added without replacing account items."
          : "No active items were added to this account; the unassigned copy is marked assigned.",
      });
      window.requestAnimationFrame(() => claimFeedbackRef.current?.focus());
    } catch {
      setClaimFeedback({
        kind: "error",
        text: "Codewire could not finish assigning the device data. Existing account items were not replaced, and retrying is safe.",
      });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <section
      id="backup"
      className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-4"
      aria-labelledby="data-safety-title"
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${status.iconClass}`}
        >
          <StatusIcon size={21} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="data-safety-title" className="font-bold">
            Data safety
          </h2>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className={`text-sm font-medium ${status.textClass}`}>
              {status.title}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
              {status.detail}
            </p>
          </div>
          {cloudEligible && sync.lastSuccessAt && (
            <p className="mt-1 text-xs text-slate-400">
              Last cloud sync{" "}
              <time dateTime={new Date(sync.lastSuccessAt).toISOString()}>
                {new Date(sync.lastSuccessAt).toLocaleString()}
              </time>
            </p>
          )}
        </div>
        {cloudEligible && sync.canRetry && sync.phase !== "syncing" && (
          <button
            type="button"
            onClick={() => void sync.retry().catch(() => {})}
            className="min-h-11 shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 outline-none active:bg-slate-700 focus-visible:ring-2 focus-visible:ring-brand"
          >
            {sync.phase === "error" ? "Try again" : "Sync now"}
          </button>
        )}
      </div>

      {!authLoading && !user && cloudEnabled && (
        <Link to="/login?next=%2Fjobs" className="mt-3 inline-block text-sm font-medium text-brand">
          Sign in for cloud sync
        </Link>
      )}
      {user && subscription.error && (
        <button
          type="button"
          onClick={subscription.refresh}
          className="mt-3 text-sm font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Check cloud access again
        </button>
      )}
      {user && subscription.ready && !subscription.error && !isPro && (
        <Link to="/upgrade" className="mt-3 inline-block text-sm font-medium text-brand">
          Upgrade for cloud sync
        </Link>
      )}

      {cloudEligible && sync.errorKind === "pro_required" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={subscription.refresh}
            className="min-h-11 font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Refresh plan
          </button>
          <Link to="/account" className="font-medium text-brand">
            Manage billing
          </Link>
        </div>
      )}

      {visibleUnclaimed && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm font-semibold text-amber-200">
            Unassigned device data found
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            {visibleUnclaimed.jobs} {visibleUnclaimed.jobs === 1 ? "job" : "jobs"}, {" "}
            {visibleUnclaimed.savedCalcs} saved {" "}
            {visibleUnclaimed.savedCalcs === 1 ? "calculation" : "calculations"}
            {visibleUnclaimed.deletedItems
              ? `, and ${visibleUnclaimed.deletedItems} deletion records`
              : ""}
            . This may belong to another account previously used in this browser.
            Active items are added with new IDs when needed; deletion records are
            ignored.
          </p>
          <button
            ref={claimTriggerRef}
            type="button"
            aria-expanded={confirmClaim}
            aria-controls="claim-device-data-confirmation"
            onClick={() => setConfirmClaim((current) => !current)}
            className="mt-2 min-h-11 text-sm font-semibold text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            {confirmClaim ? "Hide confirmation" : "Add to this account"}
          </button>
          {confirmClaim && (
            <div
              id="claim-device-data-confirmation"
              className="mt-2"
              role="region"
              aria-live="polite"
            >
              <p className="text-xs font-medium text-amber-100">
                Add this data to {user?.email ?? "the signed-in account"}?
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={claimDeviceData}
                  disabled={claiming}
                  className="min-h-11 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {claiming ? "Adding..." : "Yes, add it"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmClaim(false);
                    window.requestAnimationFrame(() =>
                      claimTriggerRef.current?.focus(),
                    );
                  }}
                  disabled={claiming}
                  className="min-h-11 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Not now
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {claimFeedback && (
        <p
          ref={claimFeedbackRef}
          tabIndex={-1}
          className={`mt-3 text-sm ${
            claimFeedback.kind === "error"
              ? "text-amber-300"
              : "text-emerald-400"
          }`}
          role={claimFeedback.kind === "error" ? "alert" : "status"}
        >
          {claimFeedback.text}
        </p>
      )}

      <details className="group mt-4 border-t border-slate-800 pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <HardDrive size={17} className="text-slate-500" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Device backup</h3>
            <p className="text-xs text-slate-400">
              Export or recover a backup file
            </p>
          </div>
          <ChevronDown
            size={17}
            className="ml-auto text-slate-400 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={exportBackup}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 outline-none active:bg-slate-700 focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Download size={18} aria-hidden="true" /> Export backup
          </button>
          <label
            className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 outline-none focus-within:ring-2 focus-within:ring-brand active:bg-slate-800"
            aria-busy={readingFile}
          >
            {readingFile ? (
              <RefreshCw size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload size={18} aria-hidden="true" />
            )}{" "}
            {readingFile ? "Reading backup..." : "Import backup"}
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              onChange={inspectFile}
              disabled={readingFile}
              className="sr-only"
            />
          </label>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Backup files contain job details in plain text and are not encrypted.
          Store them securely.
        </p>

        {pending && pendingSummary && (
          <div
            className="mt-3 rounded-xl border border-brand/30 bg-brand/10 p-3 text-sm"
            role="status"
            aria-live="polite"
          >
            <p className="font-semibold text-slate-100">Ready to merge backup</p>
            <p className="mt-1 text-slate-300">
              {pendingSummary.jobs} {pendingSummary.jobs === 1 ? "job" : "jobs"} and{" "}
              {pendingSummary.savedCalcs} saved{" "}
              {pendingSummary.savedCalcs === 1 ? "calculation" : "calculations"} from{" "}
              <time dateTime={new Date(pendingSummary.exportedAt).toISOString()}>
                {new Date(pendingSummary.exportedAt).toLocaleString()}
              </time>
              .
            </p>
            <p className="mt-1 text-xs text-slate-400">
              This recovery merge never deletes or replaces active device data.
              Conflicting IDs are added as recovered copies.
            </p>
            {pendingSummary.deletedJobs + pendingSummary.deletedCalcs > 0 && (
              <p className="mt-1 text-xs text-slate-400">
                {pendingSummary.deletedJobs + pendingSummary.deletedCalcs} deletion
                records in this file will be ignored because backups do not
                contain account ownership.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={confirmMerge}
                className="min-h-11 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-white outline-none active:bg-brand focus-visible:ring-2 focus-visible:ring-brand"
              >
                Merge backup
              </button>
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  if (inputRef.current) inputRef.current.value = "";
                  window.requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="min-h-11 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 outline-none active:bg-slate-700 focus-visible:ring-2 focus-visible:ring-brand"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {feedback && (
          <p
            ref={backupFeedbackRef}
            tabIndex={-1}
            className={`mt-3 text-sm ${
              feedback.kind === "error" ? "text-amber-300" : "text-emerald-400"
            }`}
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.text}
          </p>
        )}
      </details>
    </section>
  );
}

function getStatusCopy(
  cloudEligible: boolean,
  signedIn: boolean,
  isPro: boolean,
  subscriptionLoading: boolean,
  subscriptionError: string | null,
  authLoading: boolean,
  sync: ReturnType<typeof useSyncStatus>,
) {
  if (authLoading) {
    return {
      title: "Checking data status",
      detail: "Your jobs remain available on this device.",
      icon: HardDrive,
      iconClass: "bg-slate-800 text-slate-400",
      textClass: "text-slate-300",
    };
  }
  if (signedIn && !cloudEligible && subscriptionLoading) {
    return {
      title: "Checking cloud access",
      detail: "Your jobs remain safe on this device while your plan loads.",
      icon: Cloud,
      iconClass: "bg-brand/15 text-brand",
      textClass: "text-slate-300",
    };
  }
  if (signedIn && !cloudEligible && subscriptionError) {
    return {
      title: "Cloud status unavailable",
      detail: "Your device copy is safe. Check cloud access again when online.",
      icon: AlertTriangle,
      iconClass: "bg-amber-500/15 text-amber-300",
      textClass: "text-amber-300",
    };
  }
  if (!cloudEligible) {
    return {
      title: "Saved on this device",
      detail: signedIn && !isPro
        ? "Your jobs remain available offline. Pro adds cloud backup across devices."
        : "Your jobs remain available offline. Export a backup before clearing browser data.",
      icon: HardDrive,
      iconClass: "bg-slate-800 text-slate-400",
      textClass: "text-slate-300",
    };
  }
  if (sync.phase === "syncing") {
    return {
      title: "Syncing with cloud...",
      detail: "Changes are already safe on this device.",
      icon: RefreshCw,
      iconClass: "bg-brand/15 text-brand",
      textClass: "text-brand",
    };
  }
  if (sync.phase === "pending") {
    return {
      title: "Saved locally - waiting to sync",
      detail: "The device copy is safe. Cloud sync will start shortly.",
      icon: Cloud,
      iconClass: "bg-brand/15 text-brand",
      textClass: "text-brand",
    };
  }
  if (sync.phase === "synced") {
    return {
      title: "Cloud synced",
      detail: "Device and cloud copies are up to date.",
      icon: CheckCircle2,
      iconClass: "bg-emerald-500/15 text-emerald-400",
      textClass: "text-emerald-400",
    };
  }
  if (sync.phase === "error") {
    const offline = sync.errorKind === "offline";
    const proRequired = sync.errorKind === "pro_required";
    return {
      title: offline
        ? "Saved locally - offline"
        : proRequired
          ? "Saved locally - Pro required"
          : "Saved locally - cloud sync failed",
      detail: offline
        ? "Cloud sync will retry when this device reconnects."
        : proRequired
          ? "Refresh your subscription or manage billing before retrying."
          : "Your device copy is safe. Try cloud sync again.",
      icon: offline ? CloudOff : AlertTriangle,
      iconClass: "bg-amber-500/15 text-amber-300",
      textClass: "text-amber-300",
    };
  }
  return {
    title: "Preparing cloud sync",
    detail: "Your device copy remains available while Codewire checks the cloud.",
    icon: Cloud,
    iconClass: "bg-brand/15 text-brand",
    textClass: "text-slate-300",
  };
}
