import { useSyncExternalStore } from "react";

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

const JOBS_KEY = "cw:jobs";
const CALCS_KEY = "cw:saved-calcs";
const DELETED_JOBS_KEY = "cw:deleted-jobs";
const DELETED_CALCS_KEY = "cw:deleted-calcs";

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

// Cached snapshots so useSyncExternalStore gets stable references.
let jobsCache: Job[] | null = null;
let calcsCache: SavedCalc[] | null = null;
let deletedJobsCache: DeletedMarker[] | null = null;
let deletedCalcsCache: DeletedMarker[] | null = null;

function getJobs(): Job[] {
  if (jobsCache === null) jobsCache = read<Job>(JOBS_KEY);
  return jobsCache;
}
function getCalcs(): SavedCalc[] {
  if (calcsCache === null) calcsCache = read<SavedCalc>(CALCS_KEY);
  return calcsCache;
}
function getDeletedJobs(): DeletedMarker[] {
  if (deletedJobsCache === null)
    deletedJobsCache = read<DeletedMarker>(DELETED_JOBS_KEY);
  return deletedJobsCache;
}
function getDeletedCalcs(): DeletedMarker[] {
  if (deletedCalcsCache === null)
    deletedCalcsCache = read<DeletedMarker>(DELETED_CALCS_KEY);
  return deletedCalcsCache;
}

function writeJobs(next: Job[]) {
  jobsCache = next;
  localStorage.setItem(JOBS_KEY, JSON.stringify(next));
  emit();
}
function writeCalcs(next: SavedCalc[]) {
  calcsCache = next;
  localStorage.setItem(CALCS_KEY, JSON.stringify(next));
  emit();
}
function writeDeletedJobs(next: DeletedMarker[]) {
  deletedJobsCache = next;
  localStorage.setItem(DELETED_JOBS_KEY, JSON.stringify(next));
}
function writeDeletedCalcs(next: DeletedMarker[]) {
  deletedCalcsCache = next;
  localStorage.setItem(DELETED_CALCS_KEY, JSON.stringify(next));
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
  writeJobs([job, ...getJobs()]);
  return job;
}

export function updateJob(id: string, patch: Partial<JobInput>) {
  writeJobs(
    getJobs().map((j) =>
      j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j,
    ),
  );
}

export function deleteJob(id: string) {
  const now = Date.now();
  const childCalcs = getCalcs().filter((c) => c.jobId === id);
  writeDeletedJobs(upsertMarker(getDeletedJobs(), { id, updatedAt: now }));
  writeDeletedCalcs(
    childCalcs.reduce(
      (markers, calc) => upsertMarker(markers, { id: calc.id, updatedAt: now }),
      getDeletedCalcs(),
    ),
  );
  writeJobs(getJobs().filter((j) => j.id !== id));
  writeCalcs(getCalcs().filter((c) => c.jobId !== id));
}

export function saveCalc(
  input: Omit<SavedCalc, "id" | "createdAt" | "updatedAt">,
): SavedCalc {
  const now = Date.now();
  const calc: SavedCalc = { ...input, id: uid(), createdAt: now, updatedAt: now };
  writeCalcs([calc, ...getCalcs()]);
  return calc;
}

export function deleteCalc(id: string) {
  writeDeletedCalcs(
    upsertMarker(getDeletedCalcs(), { id, updatedAt: Date.now() }),
  );
  writeCalcs(getCalcs().filter((c) => c.id !== id));
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

/** Merge cloud rows into local using last-write-wins on `updatedAt`. */
export function applyCloudData(
  cloudJobs: Job[],
  cloudCalcs: SavedCalc[],
  cloudDeletedJobs: DeletedMarker[] = [],
  cloudDeletedCalcs: DeletedMarker[] = [],
) {
  const jobsResult = mergeWithTombstones(
    getJobs(),
    cloudJobs,
    getDeletedJobs(),
    cloudDeletedJobs,
  );
  jobsCache = jobsResult.items;
  localStorage.setItem(JOBS_KEY, JSON.stringify(jobsCache));
  writeDeletedJobs(jobsResult.tombstones);

  const calcsResult = mergeWithTombstones(
    getCalcs(),
    cloudCalcs,
    getDeletedCalcs(),
    cloudDeletedCalcs,
  );
  calcsCache = calcsResult.items;
  localStorage.setItem(CALCS_KEY, JSON.stringify(calcsCache));
  writeDeletedCalcs(calcsResult.tombstones);
  emit();
}

export function mergeWithTombstones<
  T extends { id: string; updatedAt: number; createdAt: number },
>(
  local: T[],
  cloud: T[],
  localTombstones: DeletedMarker[],
  cloudTombstones: DeletedMarker[],
): { items: T[]; tombstones: DeletedMarker[] } {
  const active = mergeByUpdatedAt(local, cloud);
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

  return { items, tombstones: [...tombstones.values()] };
}

/** Pure merge: keep the newer of each id; include ids present on either side. */
export function mergeByUpdatedAt<
  T extends { id: string; updatedAt: number; createdAt: number },
>(local: T[], cloud: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const item of cloud) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// --- React hooks -----------------------------------------------------------

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useJobs(): Job[] {
  return useSyncExternalStore(subscribe, getJobs);
}
export function useSavedCalcs(): SavedCalc[] {
  return useSyncExternalStore(subscribe, getCalcs);
}
