import { useSyncExternalStore } from "react";
import {
  canonicalFingerprint,
  canonicalSerialize,
  recoveredRecord,
} from "./recoveryIds";

/**
 * On-device storage for jobs and saved calculations. Everything lives in
 * localStorage so it works fully offline (no signal, no account). The same
 * data model is designed to later sync to a cloud DB for the paid tier.
 */

export interface Job {
  id: string;
  name: string;
  jobNumber?: string;
  phone?: string;
  notes?: string;
  /** Street address line. */
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  createdAt: number;
  updatedAt: number;
}

/** Free plan can keep this many jobs; Pro is unlimited. */
export const FREE_JOB_LIMIT = 2;

/** Editable job fields (everything except id/timestamps). */
export type JobInput = Omit<Job, "id" | "createdAt" | "updatedAt">;

/** Single-line address from the structured parts (skips empty fields). */
export function formatAddress(job: Job): string {
  const cityState = [job.city, job.state].filter(Boolean).join(", ");
  return [job.address, cityState, job.zip].filter(Boolean).join(" · ");
}

export interface SavedCalc {
  id: string;
  jobId: string;
  calculatorId: string;
  /** Calculator route, e.g. "/voltage-drop", for re-opening. */
  path: string;
  /** User-facing label, e.g. "Kitchen circuit". */
  title: string;
  /** One-line input recap. */
  summary: string;
  /** One-line result recap. */
  result: string;
  /** Full calculator state, replayed when the saved calc is re-opened. */
  state: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface DeletedMarker {
  id: string;
  updatedAt: number;
}

export interface LocalDataSnapshot {
  jobs: Job[];
  savedCalcs: SavedCalc[];
  deletedJobs: DeletedMarker[];
  deletedCalcs: DeletedMarker[];
}

export interface LocalDataSummary {
  jobs: number;
  savedCalcs: number;
  deletedItems: number;
}

const JOBS_KEY = "cw:jobs";
const CALCS_KEY = "cw:saved-calcs";
const DELETED_JOBS_KEY = "cw:deleted-jobs";
const DELETED_CALCS_KEY = "cw:deleted-calcs";
const SNAPSHOT_KEY = "cw:data-v1";
const CLAIMED_GUEST_KEY = "cw:unassigned-claimed";
const CLAIM_GUEST_LOCK = "codewire-claim-unassigned-data";
const GUEST_SCOPE = "guest";

let activeScope = GUEST_SCOPE;
let activeGuestClaimToken: string | null = null;

const listeners = new Set<() => void>();
const unclaimedListeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function emitUnclaimed() {
  unclaimedSummaryCache = undefined;
  unclaimedListeners.forEach((listener) => listener());
}

function scopedKey(key: string, scope = activeScope): string {
  return scope === GUEST_SCOPE ? key : `${key}:${scope}`;
}

function emptySnapshot(): LocalDataSnapshot {
  return { jobs: [], savedCalcs: [], deletedJobs: [], deletedCalcs: [] };
}

function readArray<T>(key: string, scope: string): T[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(scopedKey(key, scope)) || "[]",
    );
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseSnapshot(raw: string | null): LocalDataSnapshot | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "jobs" in parsed &&
      Array.isArray(parsed.jobs) &&
      "savedCalcs" in parsed &&
      Array.isArray(parsed.savedCalcs) &&
      "deletedJobs" in parsed &&
      Array.isArray(parsed.deletedJobs) &&
      "deletedCalcs" in parsed &&
      Array.isArray(parsed.deletedCalcs)
    )
      return parsed as LocalDataSnapshot;
  } catch {
    // The caller can fall back to the legacy keys.
  }
  return null;
}

function readLegacySnapshotForScope(scope: string): LocalDataSnapshot {
  return {
    jobs: readArray<Job>(JOBS_KEY, scope),
    savedCalcs: readArray<SavedCalc>(CALCS_KEY, scope),
    deletedJobs: readArray<DeletedMarker>(DELETED_JOBS_KEY, scope),
    deletedCalcs: readArray<DeletedMarker>(DELETED_CALCS_KEY, scope),
  };
}

function readSnapshotForScope(scope: string): LocalDataSnapshot {
  const snapshot = readRawSnapshotForScope(scope);
  if (scope === GUEST_SCOPE && guestSnapshotIsClaimed(snapshot))
    return emptySnapshot();
  return snapshot;
}

function readRawSnapshotForScope(scope: string): LocalDataSnapshot {
  try {
    const snapshot = parseSnapshot(
      localStorage.getItem(scopedKey(SNAPSHOT_KEY, scope)),
    );
    if (snapshot) return snapshot;
  } catch {
    // Fall back to the individually guarded legacy reads.
  }
  return readLegacySnapshotForScope(scope);
}

function readGuestClaimToken(): string | null {
  try {
    return localStorage.getItem(CLAIMED_GUEST_KEY);
  } catch {
    return null;
  }
}

function guestSnapshotIsClaimed(snapshot: LocalDataSnapshot): boolean {
  const raw = readGuestClaimToken();
  if (!raw) return false;
  try {
    const marker = JSON.parse(raw) as { fingerprint?: unknown };
    return (
      typeof marker.fingerprint !== "string" ||
      marker.fingerprint === canonicalFingerprint(snapshot)
    );
  } catch {
    // Legacy markers represented a completed claim without a fingerprint.
    return true;
  }
}

function hasData(snapshot: LocalDataSnapshot): boolean {
  return (
    snapshot.jobs.length > 0 ||
    snapshot.savedCalcs.length > 0 ||
    snapshot.deletedJobs.length > 0 ||
    snapshot.deletedCalcs.length > 0
  );
}

function persistSnapshot(scope: string, snapshot: LocalDataSnapshot) {
  localStorage.setItem(scopedKey(SNAPSHOT_KEY, scope), canonicalSerialize(snapshot));
}

// One cached snapshot gives useSyncExternalStore stable references and makes
// every mutation a single atomic localStorage write.
let snapshotCache: LocalDataSnapshot | null = null;
let unclaimedSummaryCache: LocalDataSummary | null | undefined;

function getSnapshot(): LocalDataSnapshot {
  if (snapshotCache === null) {
    if (activeScope === GUEST_SCOPE)
      activeGuestClaimToken = readGuestClaimToken();
    snapshotCache = readSnapshotForScope(activeScope);
  }
  return snapshotCache;
}

function getJobs(): Job[] {
  return getSnapshot().jobs;
}
function getCalcs(): SavedCalc[] {
  return getSnapshot().savedCalcs;
}
function getDeletedJobs(): DeletedMarker[] {
  return getSnapshot().deletedJobs;
}
function getDeletedCalcs(): DeletedMarker[] {
  return getSnapshot().deletedCalcs;
}
function upsertMarker(markers: DeletedMarker[], marker: DeletedMarker) {
  return [marker, ...markers.filter((item) => item.id !== marker.id)];
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Mutations -------------------------------------------------------------

export function createJob(data: JobInput): Job {
  const now = Date.now();
  const job: Job = { ...data, id: uid(), createdAt: now, updatedAt: now };
  const current = getLocalDataSnapshot();
  commitLocalDataSnapshot({
    ...current,
    jobs: [job, ...current.jobs],
  });
  return job;
}

export function updateJob(id: string, patch: Partial<JobInput>) {
  const current = getLocalDataSnapshot();
  commitLocalDataSnapshot({
    ...current,
    jobs: current.jobs.map((job) =>
      job.id === id ? { ...job, ...patch, updatedAt: Date.now() } : job,
    ),
  });
}

export function deleteJob(id: string) {
  const now = Date.now();
  const current = getLocalDataSnapshot();
  const childCalcs = current.savedCalcs.filter((calc) => calc.jobId === id);
  commitLocalDataSnapshot({
    jobs: current.jobs.filter((job) => job.id !== id),
    savedCalcs: current.savedCalcs.filter((calc) => calc.jobId !== id),
    deletedJobs: upsertMarker(current.deletedJobs, { id, updatedAt: now }),
    deletedCalcs: childCalcs.reduce(
      (markers, calc) => upsertMarker(markers, { id: calc.id, updatedAt: now }),
      current.deletedCalcs,
    ),
  });
}

export function saveCalc(
  input: Omit<SavedCalc, "id" | "createdAt" | "updatedAt">,
): SavedCalc {
  const now = Date.now();
  const calc: SavedCalc = { ...input, id: uid(), createdAt: now, updatedAt: now };
  const current = getLocalDataSnapshot();
  commitLocalDataSnapshot({
    ...current,
    savedCalcs: [calc, ...current.savedCalcs],
  });
  return calc;
}

export function deleteCalc(id: string) {
  const current = getLocalDataSnapshot();
  commitLocalDataSnapshot({
    ...current,
    savedCalcs: current.savedCalcs.filter((calc) => calc.id !== id),
    deletedCalcs: upsertMarker(current.deletedCalcs, {
      id,
      updatedAt: Date.now(),
    }),
  });
}

export function calcsForJob(jobId: string): SavedCalc[] {
  return getCalcs().filter((c) => c.jobId === jobId);
}

// --- Cloud sync support ----------------------------------------------------

/** Raw local snapshots (used by the cloud sync layer). */
export function getAllJobs(): Job[] {
  return getJobs();
}
export function getAllCalcs(): SavedCalc[] {
  return getCalcs();
}
export function getDeletedJobMarkers(): DeletedMarker[] {
  return getDeletedJobs();
}
export function getDeletedCalcMarkers(): DeletedMarker[] {
  return getDeletedCalcs();
}

export function getLocalDataSnapshot(): LocalDataSnapshot {
  return getSnapshot();
}

/** Switch the active on-device dataset without assigning guest data. */
export function setLocalDataScope(userId: string | null) {
  const nextScope = userId ? `user:${userId}` : GUEST_SCOPE;
  if (nextScope === activeScope) return;
  activeScope = nextScope;
  activeGuestClaimToken = null;
  snapshotCache = null;
  emit();
  emitUnclaimed();
}

/** Legacy/unassigned data stays separate until the signed-in user confirms. */
export function getUnclaimedLocalDataSummary(): LocalDataSummary | null {
  if (unclaimedSummaryCache !== undefined) return unclaimedSummaryCache;
  if (activeScope === GUEST_SCOPE) return null;
  const guest = readSnapshotForScope(GUEST_SCOPE);
  if (!hasData(guest)) {
    unclaimedSummaryCache = null;
    return null;
  }
  unclaimedSummaryCache = {
    jobs: guest.jobs.length,
    savedCalcs: guest.savedCalcs.length,
    deletedItems: guest.deletedJobs.length + guest.deletedCalcs.length,
  };
  return unclaimedSummaryCache;
}

/** Explicitly merge legacy/unassigned data into the active account scope. */
export async function claimUnassignedLocalData(): Promise<boolean> {
  const requestedScope = activeScope;
  if (requestedScope === GUEST_SCOPE)
    throw new Error("Sign in before assigning device data.");

  const claim = () => claimUnassignedLocalDataLocked(requestedScope);
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(CLAIM_GUEST_LOCK, { mode: "exclusive" }, claim);
  }
  if (typeof window !== "undefined") {
    throw new Error(
      "This browser cannot safely assign device data between accounts.",
    );
  }
  return claim();
}

function claimUnassignedLocalDataLocked(requestedScope: string): boolean {
  if (activeScope !== requestedScope)
    throw new Error("The signed-in account changed. Please try again.");
  const guest = readRawSnapshotForScope(GUEST_SCOPE);
  if (guestSnapshotIsClaimed(guest)) {
    emitUnclaimed();
    return false;
  }
  if (!hasData(guest)) return false;
  const marker = canonicalSerialize({
    token: uid(),
    scope: requestedScope,
    fingerprint: canonicalFingerprint(guest),
  });

  // The marker is written first while the cross-tab lock is held. It hides
  // only this exact snapshot; a concurrent/new guest write has a different
  // fingerprint and remains recoverable.
  localStorage.setItem(CLAIMED_GUEST_KEY, marker);
  try {
    const changed = commitLocalDataSnapshot(
      addUnassignedActiveData(getLocalDataSnapshot(), guest),
    );
    emitUnclaimed();
    return changed;
  } catch (error) {
    try {
      if (readGuestClaimToken() === marker)
        localStorage.removeItem(CLAIMED_GUEST_KEY);
    } catch {
      // Preserve the original storage error. The archived snapshot remains.
    }
    emitUnclaimed();
    throw error;
  }
}

/** Commit all local collections as one atomic localStorage value. */
export function commitLocalDataSnapshot(next: LocalDataSnapshot): boolean {
  if (activeScope === GUEST_SCOPE) {
    const claimToken = readGuestClaimToken();
    if (claimToken && activeGuestClaimToken !== claimToken) {
      activeGuestClaimToken = claimToken;
      snapshotCache = null;
      throw new Error("Device data changed in another tab. Please try again.");
    }
  }
  const normalized = mergeDataSnapshots(emptySnapshot(), next);
  const serialized = canonicalSerialize(normalized);
  const current = getLocalDataSnapshot();
  if (canonicalSerialize(current) === serialized) return false;

  localStorage.setItem(scopedKey(SNAPSHOT_KEY), serialized);
  snapshotCache = normalized;
  emit();
  return true;
}

/** Merge cloud rows into local using last-write-wins on `updatedAt`. */
export function applyCloudData(
  cloudJobs: Job[],
  cloudCalcs: SavedCalc[],
  cloudDeletedJobs: DeletedMarker[] = [],
  cloudDeletedCalcs: DeletedMarker[] = [],
) {
  commitLocalDataSnapshot(
    mergeDataSnapshots(
      getLocalDataSnapshot(),
      {
        jobs: cloudJobs,
        savedCalcs: cloudCalcs,
        deletedJobs: cloudDeletedJobs,
        deletedCalcs: cloudDeletedCalcs,
      },
      true,
    ),
  );
}

function addUnassignedActiveData(
  current: LocalDataSnapshot,
  unassigned: LocalDataSnapshot,
): LocalDataSnapshot {
  const jobs = [...current.jobs];
  const savedCalcs = [...current.savedCalcs];
  const usedJobIds = new Set([
    ...current.jobs.map((job) => job.id),
    ...current.deletedJobs.map((marker) => marker.id),
  ]);
  const usedCalcIds = new Set([
    ...current.savedCalcs.map((calc) => calc.id),
    ...current.deletedCalcs.map((marker) => marker.id),
  ]);
  const currentJobs = new Map(current.jobs.map((job) => [job.id, job]));
  const currentCalcs = new Map(
    current.savedCalcs.map((calc) => [calc.id, calc]),
  );
  const jobIdMap = new Map<string, string>();

  for (const source of unassigned.jobs) {
    const existing = currentJobs.get(source.id);
    if (existing && canonicalSerialize(existing) === canonicalSerialize(source)) {
      jobIdMap.set(source.id, source.id);
      continue;
    }
    const recovered = usedJobIds.has(source.id)
      ? recoveredRecord(source, usedJobIds, currentJobs)
      : { record: source, alreadyPresent: false };
    const record = recovered.record;
    jobIdMap.set(source.id, record.id);
    if (recovered.alreadyPresent) continue;
    usedJobIds.add(record.id);
    currentJobs.set(record.id, record);
    jobs.push(record);
  }

  const activeJobIds = new Set(jobs.map((job) => job.id));
  for (const source of unassigned.savedCalcs) {
    const jobId = jobIdMap.get(source.jobId) ?? source.jobId;
    if (!activeJobIds.has(jobId)) continue;
    const candidate =
      jobId === source.jobId ? source : { ...source, jobId };
    const existing = currentCalcs.get(source.id);
    if (
      existing &&
      canonicalSerialize(existing) === canonicalSerialize(candidate)
    )
      continue;
    const recovered = usedCalcIds.has(source.id)
      ? recoveredRecord(candidate, usedCalcIds, currentCalcs)
      : { record: candidate, alreadyPresent: false };
    if (recovered.alreadyPresent) continue;
    usedCalcIds.add(recovered.record.id);
    currentCalcs.set(recovered.record.id, recovered.record);
    savedCalcs.push(recovered.record);
  }

  return {
    jobs,
    savedCalcs,
    // Unassigned deletion history has no account provenance and must never
    // remove records from the signed-in account.
    deletedJobs: current.deletedJobs,
    deletedCalcs: current.deletedCalcs,
  };
}

function mergeDataSnapshots(
  local: LocalDataSnapshot,
  incoming: LocalDataSnapshot,
  preferIncomingOnTie = false,
  deterministicOnTie = false,
): LocalDataSnapshot {
  const jobsResult = mergeWithTombstones(
    local.jobs,
    incoming.jobs,
    local.deletedJobs,
    incoming.deletedJobs,
    preferIncomingOnTie,
    deterministicOnTie,
  );
  const calcsResult = mergeWithTombstones(
    local.savedCalcs,
    incoming.savedCalcs,
    local.deletedCalcs,
    incoming.deletedCalcs,
    preferIncomingOnTie,
    deterministicOnTie,
  );
  const deletedJobTimes = new Map(
    jobsResult.tombstones.map((marker) => [marker.id, marker.updatedAt]),
  );
  const activeJobIds = new Set(jobsResult.items.map((job) => job.id));
  let deletedCalcs = calcsResult.tombstones;
  const savedCalcs = calcsResult.items.filter((calc) => {
    if (activeJobIds.has(calc.jobId)) return true;
    const deletedAt = deletedJobTimes.get(calc.jobId);
    deletedCalcs = upsertMarker(deletedCalcs, {
      id: calc.id,
      updatedAt: Math.max(deletedAt ?? 0, calc.updatedAt),
    });
    return false;
  });
  return {
    jobs: jobsResult.items,
    savedCalcs,
    deletedJobs: jobsResult.tombstones,
    deletedCalcs: sortMarkers(deletedCalcs),
  };
}

export function mergeWithTombstones<
  T extends { id: string; updatedAt: number; createdAt: number },
>(
  local: T[],
  cloud: T[],
  localTombstones: DeletedMarker[],
  cloudTombstones: DeletedMarker[],
  preferCloudOnTie = false,
  deterministicOnTie = false,
): { items: T[]; tombstones: DeletedMarker[] } {
  const active = mergeByUpdatedAt(
    local,
    cloud,
    preferCloudOnTie,
    deterministicOnTie,
  );
  const tombstones = new Map<string, DeletedMarker>();
  for (const marker of [...localTombstones, ...cloudTombstones]) {
    const existing = tombstones.get(marker.id);
    if (!existing || marker.updatedAt > existing.updatedAt)
      tombstones.set(marker.id, marker);
  }

  const items = active.filter((item) => {
    const marker = tombstones.get(item.id);
    if (!marker) return true;
    if (marker.updatedAt >= item.updatedAt) return false;
    tombstones.delete(item.id);
    return true;
  });

  return { items, tombstones: sortMarkers([...tombstones.values()]) };
}

function sortMarkers(markers: DeletedMarker[]): DeletedMarker[] {
  return [...markers].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Pure merge: keep the newer of each id; include ids present on either side. */
export function mergeByUpdatedAt<
  T extends { id: string; updatedAt: number; createdAt: number },
>(
  local: T[],
  cloud: T[],
  preferCloudOnTie = false,
  deterministicOnTie = false,
): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const item of cloud) {
    const existing = byId.get(item.id);
    if (
      !existing ||
      item.updatedAt > existing.updatedAt ||
      (item.updatedAt === existing.updatedAt &&
        (preferCloudOnTie ||
          (deterministicOnTie &&
            canonicalSerialize(item) > canonicalSerialize(existing))))
    )
      byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

let storageRefreshQueued = false;
function handleStorageChange(event: StorageEvent) {
  const activeSnapshotKey = scopedKey(SNAPSHOT_KEY);
  const legacyKeys = [
    JOBS_KEY,
    CALCS_KEY,
    DELETED_JOBS_KEY,
    DELETED_CALCS_KEY,
  ];

  if (event.key === CLAIMED_GUEST_KEY) {
    if (activeScope === GUEST_SCOPE) {
      activeGuestClaimToken = event.newValue;
      snapshotCache = null;
    } else {
      emitUnclaimed();
      return;
    }
  } else if (event.key === null) {
    snapshotCache = null;
    activeGuestClaimToken = null;
    emitUnclaimed();
  } else if (event.key === activeSnapshotKey) {
    const incoming = parseSnapshot(event.newValue);
    if (incoming && snapshotCache) {
      // A second tab may have written from the same older snapshot. Reconcile
      // its event with this tab's last durable view so independent edits
      // converge instead of remaining last-writer-wins snapshots.
      const merged = mergeDataSnapshots(snapshotCache, incoming, false, true);
      const serialized = canonicalSerialize(merged);
      if (serialized !== event.newValue)
        localStorage.setItem(activeSnapshotKey, serialized);
      snapshotCache = merged;
    } else {
      snapshotCache = null;
    }
  } else if (activeScope !== GUEST_SCOPE && event.key === SNAPSHOT_KEY) {
    // Another tab changed the unassigned dataset while this account is active.
    // The active cache/cloud revision is untouched; only recovery UI refreshes.
    emitUnclaimed();
    return;
  } else if (legacyKeys.includes(event.key)) {
    // An already-open pre-update tab still writes the old four keys. Preserve
    // those edits in the unassigned guest snapshot; a signed-in user must
    // explicitly claim them rather than receiving another account's data.
    const legacyDelta = emptySnapshot();
    if (event.key === JOBS_KEY)
      legacyDelta.jobs = readArray<Job>(JOBS_KEY, GUEST_SCOPE);
    else if (event.key === CALCS_KEY) {
      legacyDelta.jobs = readArray<Job>(JOBS_KEY, GUEST_SCOPE);
      legacyDelta.savedCalcs = readArray<SavedCalc>(CALCS_KEY, GUEST_SCOPE);
    } else if (event.key === DELETED_JOBS_KEY)
      legacyDelta.deletedJobs = readArray<DeletedMarker>(
        DELETED_JOBS_KEY,
        GUEST_SCOPE,
      );
    else
      legacyDelta.deletedCalcs = readArray<DeletedMarker>(
        DELETED_CALCS_KEY,
        GUEST_SCOPE,
      );
    const claimToken = readGuestClaimToken();
    const guest = mergeDataSnapshots(
      claimToken ? emptySnapshot() : readRawSnapshotForScope(GUEST_SCOPE),
      legacyDelta,
      false,
      true,
    );
    persistSnapshot(GUEST_SCOPE, guest);
    if (activeScope === GUEST_SCOPE) {
      activeGuestClaimToken = claimToken;
      snapshotCache = guest;
    } else {
      emitUnclaimed();
      return;
    }
  } else {
    return;
  }

  if (storageRefreshQueued) return;
  storageRefreshQueued = true;
  queueMicrotask(() => {
    storageRefreshQueued = false;
    emit();
  });
}

if (typeof window !== "undefined")
  window.addEventListener("storage", handleStorageChange);

// --- React hooks -----------------------------------------------------------

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function subscribeUnclaimed(cb: () => void) {
  unclaimedListeners.add(cb);
  return () => unclaimedListeners.delete(cb);
}

export function useJobs(): Job[] {
  return useSyncExternalStore(subscribe, getJobs);
}
export function useSavedCalcs(): SavedCalc[] {
  return useSyncExternalStore(subscribe, getCalcs);
}
export function useUnclaimedLocalData(): LocalDataSummary | null {
  return useSyncExternalStore(
    subscribeUnclaimed,
    getUnclaimedLocalDataSummary,
    getUnclaimedLocalDataSummary,
  );
}
