import { supabase } from "./supabase";
import {
  applyCloudData,
  getAllCalcs,
  getAllJobs,
  getDeletedCalcMarkers,
  getDeletedJobMarkers,
  subscribe,
  type DeletedMarker,
  type Job,
  type SavedCalc,
} from "./jobs";

/**
 * Pro-only cloud sync. Local storage stays the working/offline store; this
 * mirrors it to Supabase and merges remote changes back in (last-write-wins).
 *
 * Deletion safety: v1 deliberately does not delete cloud rows. A local delete
 * can therefore reappear on a later pull, but a failed/partial pull can never
 * turn an empty device into an instruction to erase the user's cloud data.
 * Proper cross-device deletes require durable tombstones on both sides.
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
    state: c.state,
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
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function pull() {
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

  applyCloudData(
    (jobsResult.data ?? [])
      .filter((r) => !(r as JobRow).deleted)
      .map((r) => rowToJob(r as JobRow)),
    (calcsResult.data ?? [])
      .filter((r) => !(r as CalcRow).deleted)
      .map((r) => rowToCalc(r as CalcRow)),
    (jobsResult.data ?? [])
      .filter((r) => (r as JobRow).deleted)
      .map((r) => ({ id: (r as JobRow).id, updatedAt: (r as JobRow).updated_at })),
    (calcsResult.data ?? [])
      .filter((r) => (r as CalcRow).deleted)
      .map((r) => ({ id: (r as CalcRow).id, updatedAt: (r as CalcRow).updated_at })),
  );
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

export async function push(userId: string) {
  if (!supabase) return;
  const jobs = getAllJobs();
  const calcs = getAllCalcs();
  const deletedJobs = getDeletedJobMarkers();
  const deletedCalcs = getDeletedCalcMarkers();

  // Writes (insert/update) are Pro-gated in the database (RLS). Check the result
  // and bail before the delete phase if the account isn't entitled, so a
  // non-Pro client can't diverge local and cloud state.
  if (jobs.length) {
    const { error } = await supabase
      .from("jobs")
      .upsert(jobs.map((j) => jobToRow(j, userId)));
    if (isProRejection(error)) throw new ProRequiredError();
    if (error) throw error;
  }
  if (calcs.length) {
    const { error } = await supabase
      .from("saved_calcs")
      .upsert(calcs.map((c) => calcToRow(c, userId)));
    if (isProRejection(error)) throw new ProRequiredError();
    if (error) throw error;
  }

  await pushTombstones("jobs", deletedJobs);
  await pushTombstones("saved_calcs", deletedCalcs);
}

async function pushTombstones(
  table: "jobs" | "saved_calcs",
  markers: DeletedMarker[],
) {
  if (!supabase) return;
  for (const marker of markers) {
    const { error } = await supabase
      .from(table)
      .update({ deleted: true, updated_at: marker.updatedAt })
      .eq("id", marker.id);
    if (isProRejection(error)) throw new ProRequiredError();
    if (error) throw error;
  }
}

export async function fullSync(userId: string) {
  await pull(); // merge remote first
  await push(userId); // then mirror merged local back up
}

/**
 * Subscribe to local store changes and debounce a push to the cloud.
 * Returns an unsubscribe function.
 */
export function startAutoSync(userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      push(userId).catch(() => {
        /* offline / transient — retried on next change */
      });
    }, 1500);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}
