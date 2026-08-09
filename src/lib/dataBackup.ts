import {
  commitLocalDataSnapshot,
  getLocalDataSnapshot,
  type DeletedMarker,
  type Job,
  type SavedCalc,
} from "./jobs";
import { canonicalSerialize, recoveredRecord } from "./recoveryIds";
import { OFFSET_ANGLES, TAKE_UP } from "./calc/conduitBending";
import {
  CONDUIT_TYPE_LABEL,
  tradeSizesFor,
  type ConduitType,
} from "./nec/2023/conduitAreas";
import {
  INSULATION_LABEL,
  insulationSizes,
  type Insulation,
} from "./nec/2023/insulationAreas";
import { BOX_FILL_SIZES } from "./nec/2023/boxFill";
import { WIRE_SIZES } from "./nec/types";

export const BACKUP_FORMAT = "codewire-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export interface CodewireBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  jobs: Job[];
  savedCalcs: SavedCalc[];
  tombstones: {
    jobs: DeletedMarker[];
    savedCalcs: DeletedMarker[];
  };
}

export interface BackupSummary {
  exportedAt: number;
  jobs: number;
  savedCalcs: number;
  deletedJobs: number;
  deletedCalcs: number;
}

export interface BackupImportResult extends BackupSummary {
  jobsAdded: number;
  jobsUpdated: number;
  jobsRestored: number;
  jobsSkipped: number;
  calcsAdded: number;
  calcsUpdated: number;
  calcsRestored: number;
  calcsSkipped: number;
}

const MAX_RECORDS_PER_COLLECTION = 10_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export class BackupValidationError extends Error {
  constructor(detail: string) {
    super(`This is not a valid Codewire backup (${detail}).`);
    this.name = "BackupValidationError";
  }
}

function invalid(detail: string): never {
  throw new BackupValidationError(detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(field);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(field);
  return value;
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid(field);
  return value;
}

function collection(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS_PER_COLLECTION)
    invalid(field);
  return value;
}

function parseJob(value: unknown, index: number): Job {
  if (!isRecord(value)) invalid(`jobs[${index}]`);
  return {
    id: requiredString(value.id, `jobs[${index}].id`),
    name: requiredString(value.name, `jobs[${index}].name`),
    jobNumber: optionalString(value.jobNumber, `jobs[${index}].jobNumber`),
    phone: optionalString(value.phone, `jobs[${index}].phone`),
    notes: optionalString(value.notes, `jobs[${index}].notes`),
    address: optionalString(value.address, `jobs[${index}].address`),
    city: optionalString(value.city, `jobs[${index}].city`),
    state: optionalString(value.state, `jobs[${index}].state`),
    zip: optionalString(value.zip, `jobs[${index}].zip`),
    createdAt: timestamp(value.createdAt, `jobs[${index}].createdAt`),
    updatedAt: timestamp(value.updatedAt, `jobs[${index}].updatedAt`),
  };
}

const CALCULATOR_PATHS: Record<string, string> = {
  "voltage-drop": "/voltage-drop",
  "conduit-fill": "/conduit-fill",
  ampacity: "/ampacity",
  "box-fill": "/box-fill",
  "conduit-bending": "/conduit-bending",
};

function choice<T extends string | number>(
  value: unknown,
  choices: readonly T[],
  field: string,
): T {
  if (!choices.includes(value as T)) invalid(field);
  return value as T;
}

function numberOrBlank(value: unknown, field: string): number | "" {
  if (value === "") return "";
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(field);
  return value;
}

function stateRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(field);
  return value;
}

export function parseCalculatorState(
  calculatorId: string,
  path: string,
  value: unknown,
  field: string,
): unknown {
  const expectedPath = CALCULATOR_PATHS[calculatorId];
  if (!expectedPath || path !== expectedPath) invalid(`${field} calculator path`);
  const state = stateRecord(value, field);

  if (calculatorId === "voltage-drop") {
    return {
      phase: choice(state.phase, ["single", "three"], `${field}.phase`),
      material: choice(state.material, ["cu", "al"], `${field}.material`),
      size: choice(state.size, WIRE_SIZES, `${field}.size`),
      current: numberOrBlank(state.current, `${field}.current`),
      length: numberOrBlank(state.length, `${field}.length`),
      voltage: numberOrBlank(state.voltage, `${field}.voltage`),
      sets: numberOrBlank(state.sets, `${field}.sets`),
    };
  }

  if (calculatorId === "conduit-fill") {
    const type = choice(
      state.type,
      Object.keys(CONDUIT_TYPE_LABEL) as ConduitType[],
      `${field}.type`,
    );
    const tradeSize = choice(
      state.tradeSize,
      tradeSizesFor(type),
      `${field}.tradeSize`,
    );
    const conductors = collection(state.conductors, `${field}.conductors`).map(
      (entry, index) => {
        const row = stateRecord(entry, `${field}.conductors[${index}]`);
        const insulation = choice(
          row.insulation,
          Object.keys(INSULATION_LABEL) as Insulation[],
          `${field}.conductors[${index}].insulation`,
        );
        return {
          insulation,
          size: choice(
            row.size,
            insulationSizes(insulation),
            `${field}.conductors[${index}].size`,
          ),
          quantity: finiteNumber(
            row.quantity,
            `${field}.conductors[${index}].quantity`,
          ),
        };
      },
    );
    return { type, tradeSize, conductors };
  }

  if (calculatorId === "ampacity") {
    const ratings = [60, 75, 90] as const;
    return {
      material: choice(state.material, ["cu", "al"], `${field}.material`),
      size: choice(state.size, WIRE_SIZES, `${field}.size`),
      tempRating: choice(state.tempRating, ratings, `${field}.tempRating`),
      ambientC: numberOrBlank(state.ambientC, `${field}.ambientC`),
      currentCarrying: numberOrBlank(
        state.currentCarrying,
        `${field}.currentCarrying`,
      ),
      terminationRating: choice(
        state.terminationRating,
        ratings,
        `${field}.terminationRating`,
      ),
      load: numberOrBlank(state.load, `${field}.load`),
    };
  }

  if (calculatorId === "box-fill") {
    const conductors = collection(state.conductors, `${field}.conductors`).map(
      (entry, index) => {
        const row = stateRecord(entry, `${field}.conductors[${index}]`);
        return {
          size: choice(
            row.size,
            BOX_FILL_SIZES,
            `${field}.conductors[${index}].size`,
          ),
          quantity: finiteNumber(
            row.quantity,
            `${field}.conductors[${index}].quantity`,
          ),
        };
      },
    );
    if (typeof state.hasClamps !== "boolean") invalid(`${field}.hasClamps`);
    return {
      boxVolume: numberOrBlank(state.boxVolume, `${field}.boxVolume`),
      conductors,
      devices: numberOrBlank(state.devices, `${field}.devices`),
      hasClamps: state.hasClamps,
      groundSize: choice(
        state.groundSize,
        ["none", ...BOX_FILL_SIZES],
        `${field}.groundSize`,
      ),
    };
  }

  return {
    mode: choice(
      state.mode,
      ["offset", "saddle3", "saddle4", "stub"],
      `${field}.mode`,
    ),
    offsetHeight: numberOrBlank(state.offsetHeight, `${field}.offsetHeight`),
    angle: choice(state.angle, OFFSET_ANGLES, `${field}.angle`),
    saddleDepth: numberOrBlank(state.saddleDepth, `${field}.saddleDepth`),
    saddle4Depth: numberOrBlank(
      state.saddle4Depth,
      `${field}.saddle4Depth`,
    ),
    saddle4Angle: choice(
      state.saddle4Angle,
      OFFSET_ANGLES,
      `${field}.saddle4Angle`,
    ),
    stubHeight: numberOrBlank(state.stubHeight, `${field}.stubHeight`),
    takeUpSize: choice(
      state.takeUpSize,
      Object.keys(TAKE_UP),
      `${field}.takeUpSize`,
    ),
  };
}

function parseCalc(value: unknown, index: number): SavedCalc {
  if (!isRecord(value)) invalid(`savedCalcs[${index}]`);
  if (!("state" in value)) invalid(`savedCalcs[${index}].state`);
  const calculatorId = requiredString(
    value.calculatorId,
    `savedCalcs[${index}].calculatorId`,
  );
  const path = requiredString(value.path, `savedCalcs[${index}].path`);
  return {
    id: requiredString(value.id, `savedCalcs[${index}].id`),
    jobId: requiredString(value.jobId, `savedCalcs[${index}].jobId`),
    calculatorId,
    path,
    title: requiredString(value.title, `savedCalcs[${index}].title`),
    summary: requiredString(value.summary, `savedCalcs[${index}].summary`),
    result: requiredString(value.result, `savedCalcs[${index}].result`),
    state: parseCalculatorState(
      calculatorId,
      path,
      value.state,
      `savedCalcs[${index}].state`,
    ),
    createdAt: timestamp(value.createdAt, `savedCalcs[${index}].createdAt`),
    updatedAt: timestamp(value.updatedAt, `savedCalcs[${index}].updatedAt`),
  };
}

function parseMarker(value: unknown, field: string): DeletedMarker {
  if (!isRecord(value)) invalid(field);
  return {
    id: requiredString(value.id, `${field}.id`),
    updatedAt: timestamp(value.updatedAt, `${field}.updatedAt`),
  };
}

function ensureUnique(ids: string[], field: string) {
  if (new Set(ids).size !== ids.length) invalid(`${field} contains duplicates`);
}

function validateTimeline(
  items: Array<{ createdAt: number; updatedAt: number }>,
  exportedAt: number,
  field: string,
) {
  if (
    items.some(
      (item) => item.createdAt > item.updatedAt || item.updatedAt > exportedAt,
    )
  )
    invalid(`${field} has an invalid timestamp`);
}

function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    return false;
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) < 32) return false;
  }
  return true;
}

export function createBackup(exportedAt = Date.now()): CodewireBackup {
  const snapshot = getLocalDataSnapshot();
  const clampItem = <T extends { createdAt: number; updatedAt: number }>(
    item: T,
  ): T => {
    const updatedAt = Math.min(item.updatedAt, exportedAt);
    return {
      ...item,
      createdAt: Math.min(item.createdAt, updatedAt),
      updatedAt,
    };
  };
  const clampMarker = (marker: DeletedMarker): DeletedMarker => ({
    ...marker,
    updatedAt: Math.min(marker.updatedAt, exportedAt),
  });
  const backup: CodewireBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    jobs: snapshot.jobs.map(clampItem),
    savedCalcs: snapshot.savedCalcs.map(clampItem),
    tombstones: {
      jobs: snapshot.deletedJobs.map(clampMarker),
      savedCalcs: snapshot.deletedCalcs.map(clampMarker),
    },
  };
  return parseBackup(JSON.stringify(backup), exportedAt);
}

export function serializeBackup(backup = createBackup()): string {
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(text: string, now = Date.now()): CodewireBackup {
  const byteLength =
    typeof TextEncoder === "undefined"
      ? text.length
      : new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_BACKUP_BYTES) invalid("the file is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid("the JSON could not be read");
  }
  if (!isRecord(raw)) invalid("missing backup object");
  if (raw.format !== BACKUP_FORMAT) invalid("unknown format");
  if (raw.version !== BACKUP_VERSION) invalid("unsupported version");

  const exportedAt = timestamp(raw.exportedAt, "exportedAt");
  if (exportedAt > now + MAX_CLOCK_SKEW_MS) invalid("exportedAt is in the future");
  const jobs = collection(raw.jobs, "jobs").map(parseJob);
  const savedCalcs = collection(raw.savedCalcs, "savedCalcs").map(parseCalc);
  if (!isRecord(raw.tombstones)) invalid("tombstones");
  const deletedJobs = collection(raw.tombstones.jobs, "tombstones.jobs").map(
    (value, index) => parseMarker(value, `tombstones.jobs[${index}]`),
  );
  const deletedCalcs = collection(
    raw.tombstones.savedCalcs,
    "tombstones.savedCalcs",
  ).map((value, index) =>
    parseMarker(value, `tombstones.savedCalcs[${index}]`),
  );

  ensureUnique(jobs.map((item) => item.id), "jobs");
  ensureUnique(savedCalcs.map((item) => item.id), "savedCalcs");
  ensureUnique(deletedJobs.map((item) => item.id), "tombstones.jobs");
  ensureUnique(deletedCalcs.map((item) => item.id), "tombstones.savedCalcs");
  validateTimeline(jobs, exportedAt, "jobs");
  validateTimeline(savedCalcs, exportedAt, "savedCalcs");
  if (
    [...deletedJobs, ...deletedCalcs].some(
      (marker) => marker.updatedAt > exportedAt,
    )
  )
    invalid("a tombstone is newer than the export");

  const jobIds = new Set(jobs.map((job) => job.id));
  if (savedCalcs.some((calc) => !jobIds.has(calc.jobId)))
    invalid("a saved calculation has no matching job");
  if (
    savedCalcs.some((calc) => !isSafeInternalPath(calc.path))
  )
    invalid("a saved calculation has an unsafe path");
  if (deletedJobs.some((marker) => jobIds.has(marker.id)))
    invalid("a job is both active and deleted");
  const calcIds = new Set(savedCalcs.map((calc) => calc.id));
  if (deletedCalcs.some((marker) => calcIds.has(marker.id)))
    invalid("a saved calculation is both active and deleted");

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    jobs,
    savedCalcs,
    tombstones: { jobs: deletedJobs, savedCalcs: deletedCalcs },
  };
}

export function summarizeBackup(backup: CodewireBackup): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    jobs: backup.jobs.length,
    savedCalcs: backup.savedCalcs.length,
    deletedJobs: backup.tombstones.jobs.length,
    deletedCalcs: backup.tombstones.savedCalcs.length,
  };
}

interface ActiveRecoveryResult<T> {
  items: T[];
  idMap: Map<string, string>;
  added: number;
  updated: number;
  restored: number;
  skipped: number;
}

function mergeUnownedActive<
  T extends { id: string; createdAt: number; updatedAt: number },
>(
  local: T[],
  incoming: T[],
  localTombstones: DeletedMarker[],
): ActiveRecoveryResult<T> {
  const items = [...local];
  const byId = new Map(local.map((item) => [item.id, item]));
  const tombstoneIds = new Set(localTombstones.map((marker) => marker.id));
  const usedIds = new Set([...byId.keys(), ...tombstoneIds]);
  const idMap = new Map<string, string>();
  let added = 0;
  let restored = 0;
  let skipped = 0;

  for (const source of incoming) {
    const existing = byId.get(source.id);
    if (
      existing &&
      canonicalSerialize(existing) === canonicalSerialize(source)
    ) {
      idMap.set(source.id, source.id);
      skipped += 1;
      continue;
    }

    const recovered = usedIds.has(source.id)
      ? recoveredRecord(source, usedIds, byId)
      : { record: source, alreadyPresent: false };
    idMap.set(source.id, recovered.record.id);
    if (recovered.alreadyPresent) {
      skipped += 1;
      continue;
    }
    items.push(recovered.record);
    usedIds.add(recovered.record.id);
    byId.set(recovered.record.id, recovered.record);
    if (tombstoneIds.has(source.id)) restored += 1;
    else added += 1;
  }

  return {
    items: items.sort((a, b) => b.createdAt - a.createdAt),
    idMap,
    added,
    updated: 0,
    restored,
    skipped,
  };
}

/**
 * Recover active records without applying deletion history from the file.
 * Unowned ID collisions become deterministic recovered copies, and child
 * calculations follow the recovered parent instead of an unrelated local job.
 */
export function mergeBackup(backup: CodewireBackup): BackupImportResult {
  const current = getLocalDataSnapshot();
  const jobs = mergeUnownedActive(
    current.jobs,
    backup.jobs,
    current.deletedJobs,
  );
  const remappedCalcs = backup.savedCalcs.map((calc) => ({
    ...calc,
    jobId: jobs.idMap.get(calc.jobId) ?? calc.jobId,
  }));
  const calcs = mergeUnownedActive(
    current.savedCalcs,
    remappedCalcs,
    current.deletedCalcs,
  );
  commitLocalDataSnapshot({
    jobs: jobs.items,
    savedCalcs: calcs.items,
    deletedJobs: current.deletedJobs,
    deletedCalcs: current.deletedCalcs,
  });
  return {
    ...summarizeBackup(backup),
    jobsAdded: jobs.added,
    jobsUpdated: jobs.updated,
    jobsRestored: jobs.restored,
    jobsSkipped: jobs.skipped,
    calcsAdded: calcs.added,
    calcsUpdated: calcs.updated,
    calcsRestored: calcs.restored,
    calcsSkipped: calcs.skipped,
  };
}

export function backupFilename(exportedAt = Date.now()) {
  return `codewire-backup-${new Date(exportedAt).toISOString().slice(0, 10)}.json`;
}
