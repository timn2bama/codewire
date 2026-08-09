import { useSyncExternalStore } from "react";
import { ProRequiredError } from "./cloudSync";

export type SyncPhase =
  | "local"
  | "idle"
  | "pending"
  | "syncing"
  | "synced"
  | "error";
export type SyncErrorKind = "offline" | "pro_required" | "unknown";

export interface SyncStatus {
  phase: SyncPhase;
  errorKind: SyncErrorKind | null;
  lastSuccessAt: number | null;
  canRetry: boolean;
}

const LAST_SUCCESS_PREFIX = "cw:last-sync-at:";
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;
const listeners = new Set<() => void>();
let activeUserId: string | null = null;
let retryHandler: (() => Promise<void>) | null = null;
let snapshot: SyncStatus = {
  phase: "local",
  errorKind: null,
  lastSuccessAt: null,
  canRetry: false,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function publish(patch: Partial<SyncStatus>) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function readLastSuccess(userId: string): number | null {
  try {
    const value = Number(localStorage.getItem(`${LAST_SUCCESS_PREFIX}${userId}`));
    return Number.isSafeInteger(value) &&
      value > 0 &&
      value <= MAX_DATE_TIMESTAMP
      ? value
      : null;
  } catch {
    return null;
  }
}

export function activateSyncStatus(userId: string) {
  activeUserId = userId;
  retryHandler = null;
  snapshot = {
    phase: "idle",
    errorKind: null,
    lastSuccessAt: readLastSuccess(userId),
    canRetry: false,
  };
  emit();
}

export function setLocalOnlyStatus() {
  activeUserId = null;
  retryHandler = null;
  snapshot = {
    phase: "local",
    errorKind: null,
    lastSuccessAt: null,
    canRetry: false,
  };
  emit();
}

export function registerSyncRetry(handler: (() => Promise<void>) | null) {
  retryHandler = handler;
  publish({ canRetry: Boolean(handler) });
}

export function markSyncing() {
  publish({ phase: "syncing", errorKind: null });
}

export function markSyncPending() {
  publish({ phase: "pending", errorKind: null });
}

export function markSyncSuccess(at = Date.now()) {
  if (activeUserId) {
    try {
      localStorage.setItem(`${LAST_SUCCESS_PREFIX}${activeUserId}`, String(at));
    } catch {
      // Sync itself succeeded; storage quota/privacy mode should not turn that
      // success into a false cloud failure.
    }
  }
  publish({ phase: "synced", errorKind: null, lastSuccessAt: at });
}

export function classifySyncError(error: unknown): SyncErrorKind {
  if (error instanceof ProRequiredError) return "pro_required";
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "offline";
  return "unknown";
}

export function markSyncError(error: unknown) {
  publish({ phase: "error", errorKind: classifySyncError(error) });
}

export async function retrySync() {
  if (!retryHandler) return;
  await retryHandler();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function useSyncStatus() {
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...status, retry: retrySync };
}
