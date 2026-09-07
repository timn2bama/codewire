import { supabase } from "./supabase";
import {
  applyCloudData,
  getAllCalcs,
  getAllJobs,
  getDeletedCalcMarkers,
  getDeletedJobMarkers,
  subscribe,
  type Job,
  type SavedCalc,
} from "./jobs";
import { parseCalculatorState } from "./dataBackup";

/**
 * Pro-only cloud sync. Local storage stays the working/offline store; this
 * mirrors it to Supabase and merges remote changes back in (last-write-wins).
 *
 * Deletions are mirrored as durable tombstones. A failed or partial pull is
 * never applied, so an empty response cannot erase or resurrect device data.
 */

type JobRow = {
  id: string;
  user_id: string;
  name: string;
  job_number: string | null;
  phone: string | null;
  notes: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  created_at: number;
  updated_at: number;
  deleted: boolean;
};

type CalcRow = {
  id: string;
  user_id: string;
  job_id: string;
  calculator_id: string;
  path: string;
  title: string;
  summary: string;
  result: string;
  state: unknown;
  created_at: number;
  updated_at: number;
  deleted: boolean;
};

const n = (v: string | undefined) => v ?? null;

function jobToRow(j: Job, userId: string): JobRow {
  return {
    id: j.id,
    user_id: userId,
    name: j.name,
    job_number: n(j.jobNumber),
    phone: n(j.phone),
    notes: n(j.notes),
    address: n(j.address),
    city: n(j.city),
    state: n(j.state),
    zip: n(j.zip),
    created_at: j.createdAt,
    updated_at: j.updatedAt,
    deleted: false,
  };
}

function rowToJob(r: JobRow): Job {
  return {
    id: r.id,
    name: r.name,
    jobNumber: r.job_number ?? undefined,
    phone: r.phone ?? undefined,
    notes: r.notes ?? undefined,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zip: r.zip ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function calcToRow(c: SavedCalc, userId: string): CalcRow {
  return {
    id: c.id,
    user_id: userId,
    job_id: c.jobId,
    calculator_id: c.calculatorId,
    path: c.path,
    title: c.title,
    summary: c.summary,
    result: c.result,
    state: parseCalculatorState(
      c.calculatorId,
      c.path,
      c.state,
      `saved calculation ${c.id}`,
    ),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    deleted: false,
  };
}

function rowToCalc(r: CalcRow): SavedCalc {
  return {
    id: r.id,
    jobId: r.job_id,
    calculatorId: r.calculator_id,
    path: r.path,
    title: r.title,
    summary: r.summary,
    result: r.result,
    state: parseCalculatorState(
      r.calculator_id,
      r.path,
      r.state,
      `cloud calculation ${r.id}`,
    ),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function applyRows(jobRows: JobRow[], calcRows: CalcRow[]) {
  applyCloudData(
    jobRows.filter((row) => !row.deleted).map(rowToJob),
    calcRows.filter((row) => !row.deleted).map(rowToCalc),
    jobRows
      .filter((row) => row.deleted)
      .map((row) => ({ id: row.id, updatedAt: row.updated_at })),
    calcRows
      .filter((row) => row.deleted)
      .map((row) => ({ id: row.id, updatedAt: row.updated_at })),
  );
}

export async function pull(shouldApply: () => boolean = () => true) {
  if (!supabase) return;
  const [jobsResult, calcsResult] = await Promise.all([
    supabase.from("jobs").select("*"),
    supabase.from("saved_calcs").select("*"),
  ]);

  // Never apply a partial snapshot. PostgREST returns errors alongside null
  // data; treating null as [] would make a network/auth failure look like an
  // authoritative empty cloud.
  if (jobsResult.error) throw jobsResult.error;
  if (calcsResult.error) throw calcsResult.error;
  if (!shouldApply()) return;

  applyRows(jobsResult.data as JobRow[], calcsResult.data as CalcRow[]);
}

/** Thrown when a cloud write is rejected because the account isn't Pro. */
export class ProRequiredError extends Error {
  constructor() {
    super("Cloud sync requires Codewire Pro.");
    this.name = "ProRequiredError";
  }
}

// Postgres RLS rejects a with-check violation with code 42501 (and PostgREST
// surfaces it as such). Treat that on a write as "not entitled to sync".
function isProRejection(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}

export async function push(
  userId: string,
  shouldApply: () => boolean = () => true,
) {
  if (!supabase) return;
  const jobs = getAllJobs();
  const calcs = getAllCalcs();
  const deletedJobs = getDeletedJobMarkers();
  const deletedCalcs = getDeletedCalcMarkers();

  const jobRows: JobRow[] = [
    ...jobs.map((job) => jobToRow(job, userId)),
    ...deletedJobs.map((marker) => ({
      id: marker.id,
      user_id: userId,
      name: "",
      job_number: null,
      phone: null,
      notes: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      created_at: marker.updatedAt,
      updated_at: marker.updatedAt,
      deleted: true,
    })),
  ];
  const calcRows: CalcRow[] = [
    ...calcs.map((calc) => calcToRow(calc, userId)),
    ...deletedCalcs.map((marker) => ({
      id: marker.id,
      user_id: userId,
      job_id: "",
      calculator_id: "",
      path: "/",
      title: "",
      summary: "",
      result: "",
      state: {},
      created_at: marker.updatedAt,
      updated_at: marker.updatedAt,
      deleted: true,
    })),
  ];

  const { data, error } = await supabase.rpc("sync_codewire", {
    p_job_rows: jobRows,
    p_calc_rows: calcRows,
  });
  if (isProRejection(error)) throw new ProRequiredError();
  if (error) throw error;
  if (!shouldApply()) return;
  if (
    !data ||
    typeof data !== "object" ||
    !("jobs" in data) ||
    !Array.isArray(data.jobs) ||
    !("saved_calcs" in data) ||
    !Array.isArray(data.saved_calcs)
  )
    throw new Error("Cloud sync returned an invalid snapshot.");
  applyRows(data.jobs as JobRow[], data.saved_calcs as CalcRow[]);
}

export interface SyncControllerCallbacks {
  onPending?: () => void;
  onStart?: () => void;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export interface SyncController {
  initialSync: () => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
}

export interface SyncControllerDependencies {
  pull: (shouldApply?: () => boolean) => Promise<void>;
  push: (userId: string, shouldApply?: () => boolean) => Promise<void>;
  subscribe: (callback: () => void) => () => void;
}

const defaultControllerDependencies: SyncControllerDependencies = {
  pull,
  push,
  subscribe,
};

/** Serializes initial, automatic, reconnect, and manual sync operations. */
export function createSyncController(
  userId: string,
  callbacks: SyncControllerCallbacks = {},
  debounceMs = 1500,
  dependencies: SyncControllerDependencies = defaultControllerDependencies,
): SyncController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let initialized = false;
  let suppressAuto = true;
  let online =
    typeof navigator === "undefined" || navigator.onLine !== false;
  let revision = 0;
  let tail: Promise<void> = Promise.resolve();
  let fullTask: Promise<void> | null = null;
  let pushTask: Promise<void> | null = null;
  let queueFullAfterCurrent = false;

  const reportPending = () => {
    if (!stopped) callbacks.onPending?.();
  };
  const reportStart = () => {
    if (!stopped) callbacks.onStart?.();
  };
  const reportSuccess = () => {
    if (!stopped && online) callbacks.onSuccess?.();
  };
  const reportError = (error: unknown) => {
    if (!stopped) callbacks.onError?.(error);
  };

  const enqueue = (operation: () => Promise<void>) => {
    const task = tail.catch(() => {}).then(operation);
    tail = task;
    return task;
  };

  const pushUntilStable = async (): Promise<boolean> => {
    while (!stopped && online) {
      const capturedRevision = revision;
      await dependencies.push(userId, () => !stopped && online);
      if (stopped || !online) return false;
      if (revision === capturedRevision) return true;
    }
    return false;
  };

  const runPush = async () => {
    if (stopped || suppressAuto || !initialized || !online) return;
    reportStart();
    try {
      if (!(await pushUntilStable()) || !online) return;
      reportSuccess();
    } catch (error) {
      initialized = false;
      suppressAuto = true;
      reportError(error);
      throw error;
    }
  };

  const requestPush = () => {
    if (stopped || suppressAuto || !initialized || !online || pushTask)
      return pushTask;
    const task = enqueue(runPush).finally(() => {
      if (pushTask === task) pushTask = null;
    });
    pushTask = task;
    return task;
  };

  const schedulePush = () => {
    if (
      stopped ||
      !initialized ||
      suppressAuto ||
      !online ||
      pushTask ||
      fullTask
    )
      return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped || suppressAuto || !initialized || !online) return;
      void requestPush()?.catch(() => {
        // The status UI exposes the failure. Retry always performs a fresh pull.
      });
    }, debounceMs);
  };

  const unsub = dependencies.subscribe(() => {
    revision += 1;
    if (initialized && !suppressAuto && !pushTask && !fullTask)
      reportPending();
    schedulePush();
  });

  const requestFullSync = (queueIfBusy = false) => {
    if (stopped) return Promise.resolve();
    initialized = false;
    suppressAuto = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (fullTask) {
      if (queueIfBusy) queueFullAfterCurrent = true;
      return fullTask;
    }
    const task = enqueue(async () => {
      if (stopped) return;
      reportStart();
      try {
        if (!online) throw new Error("offline");
        await dependencies.pull(() => !stopped && online);
        if (stopped || !online) return;
        if (!(await pushUntilStable()) || stopped || !online) return;
        initialized = true;
        suppressAuto = false;
        reportSuccess();
      } catch (error) {
        initialized = false;
        suppressAuto = true;
        reportError(error);
        throw error;
      }
    }).finally(() => {
      if (fullTask === task) fullTask = null;
      if (!stopped && queueFullAfterCurrent) {
        queueFullAfterCurrent = false;
        void requestFullSync().catch(() => {});
      }
    });
    fullTask = task;
    return task;
  };

  const handleOffline = () => {
    online = false;
    initialized = false;
    suppressAuto = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    reportError(new Error("offline"));
  };
  const handleOnline = () => {
    online = true;
    void requestFullSync(true).catch(() => {});
  };
  if (typeof window !== "undefined") {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
  }

  const stop = () => {
    stopped = true;
    initialized = false;
    suppressAuto = true;
    queueFullAfterCurrent = false;
    if (timer) clearTimeout(timer);
    unsub();
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    }
  };

  return { initialSync: requestFullSync, retry: requestFullSync, stop };
}
