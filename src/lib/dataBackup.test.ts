import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletedMarker, Job, SavedCalc } from "./jobs";

const mocks = vi.hoisted(() => ({
  commitLocalDataSnapshot: vi.fn(),
  getLocalDataSnapshot: vi.fn(
    (): {
      jobs: Job[];
      savedCalcs: SavedCalc[];
      deletedJobs: DeletedMarker[];
      deletedCalcs: DeletedMarker[];
    } => ({ jobs: [], savedCalcs: [], deletedJobs: [], deletedCalcs: [] }),
  ),
}));

vi.mock("./jobs", () => mocks);

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  mergeBackup,
  parseBackup,
  type CodewireBackup,
} from "./dataBackup";

const validBackup: CodewireBackup = {
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: 500,
  jobs: [
    { id: "job-1", name: "Kitchen", createdAt: 100, updatedAt: 200 },
  ],
  savedCalcs: [
    {
      id: "calc-1",
      jobId: "job-1",
      calculatorId: "voltage-drop",
      path: "/voltage-drop",
      title: "Dishwasher",
      summary: "20 A, 80 ft",
      result: "3.1%",
      state: {
        phase: "single",
        material: "cu",
        size: "12",
        current: 20,
        length: 80,
        voltage: 120,
        sets: 1,
      },
      createdAt: 110,
      updatedAt: 210,
    },
  ],
  tombstones: { jobs: [], savedCalcs: [] },
};

describe("Codewire data backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalDataSnapshot.mockReturnValue({
      jobs: [],
      savedCalcs: [],
      deletedJobs: [],
      deletedCalcs: [],
    });
  });

  it("creates a versioned backup containing active data and tombstones", () => {
    mocks.getLocalDataSnapshot.mockReturnValue({
      jobs: validBackup.jobs,
      savedCalcs: validBackup.savedCalcs,
      deletedJobs: [{ id: "old-job", updatedAt: 50 }],
      deletedCalcs: [],
    });

    const backup = createBackup(500);

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.jobs).toHaveLength(1);
    expect(backup.tombstones.jobs).toEqual([{ id: "old-job", updatedAt: 50 }]);
  });

  it("validates the whole backup before merging it", () => {
    const backup = parseBackup(JSON.stringify(validBackup));
    mergeBackup(backup);

    expect(mocks.commitLocalDataSnapshot).toHaveBeenCalledWith({
      jobs: validBackup.jobs,
      savedCalcs: validBackup.savedCalcs,
      deletedJobs: [],
      deletedCalcs: [],
    });
  });

  it("ignores backup deletion history during a recovery merge", () => {
    const localJob: Job = {
      id: "keep-me",
      name: "Keep me",
      createdAt: 100,
      updatedAt: 200,
    };
    mocks.getLocalDataSnapshot.mockReturnValue({
      jobs: [localJob],
      savedCalcs: [],
      deletedJobs: [],
      deletedCalcs: [],
    });
    const backup = parseBackup(
      JSON.stringify({
        ...validBackup,
        tombstones: {
          jobs: [{ id: "keep-me", updatedAt: 400 }],
          savedCalcs: [],
        },
      }),
    );

    const result = mergeBackup(backup);

    expect(mocks.commitLocalDataSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: expect.arrayContaining([validBackup.jobs[0], localJob]),
      }),
    );
    expect(result.deletedJobs).toBe(1);
  });

  it("does not import an unowned tombstone onto an empty device", () => {
    const backup = parseBackup(
      JSON.stringify({
        ...validBackup,
        jobs: [],
        savedCalcs: [],
        tombstones: {
          jobs: [{ id: "foreign-job", updatedAt: 400 }],
          savedCalcs: [{ id: "foreign-calc", updatedAt: 400 }],
        },
      }),
    );

    const result = mergeBackup(backup);

    expect(mocks.commitLocalDataSnapshot).toHaveBeenCalledWith({
      jobs: [],
      savedCalcs: [],
      deletedJobs: [],
      deletedCalcs: [],
    });
    expect(result.deletedJobs).toBe(1);
    expect(result.deletedCalcs).toBe(1);
  });

  it("restores active records as safe copies when local tombstones reuse the IDs", () => {
    mocks.getLocalDataSnapshot.mockReturnValue({
      jobs: [],
      savedCalcs: [],
      deletedJobs: [{ id: "job-1", updatedAt: 550 }],
      deletedCalcs: [{ id: "calc-1", updatedAt: 550 }],
    });
    const backup = parseBackup(JSON.stringify(validBackup));

    const result = mergeBackup(backup);

    const committed = mocks.commitLocalDataSnapshot.mock.calls[0][0];
    expect(committed.jobs[0]).toEqual(
      expect.objectContaining({ name: "Kitchen" }),
    );
    expect(committed.jobs[0].id).not.toBe("job-1");
    expect(committed.savedCalcs[0]).toEqual(
      expect.objectContaining({ jobId: committed.jobs[0].id }),
    );
    expect(committed.savedCalcs[0].id).not.toBe("calc-1");
    expect(committed.deletedJobs).toEqual([
      { id: "job-1", updatedAt: 550 },
    ]);
    expect(committed.deletedCalcs).toEqual([
      { id: "calc-1", updatedAt: 550 },
    ]);
    expect(result.jobsRestored).toBe(1);
    expect(result.calcsRestored).toBe(1);
  });

  it("re-keys a foreign job collision and remaps its saved calculation", () => {
    const localJob: Job = {
      ...validBackup.jobs[0],
      name: "Local account job",
      updatedAt: 400,
    };
    mocks.getLocalDataSnapshot.mockReturnValue({
      jobs: [localJob],
      savedCalcs: [],
      deletedJobs: [],
      deletedCalcs: [],
    });

    const result = mergeBackup(parseBackup(JSON.stringify(validBackup)));
    const committed = mocks.commitLocalDataSnapshot.mock.calls[0][0];
    const recoveredJob = committed.jobs.find(
      (job: Job) => job.name === "Kitchen",
    );

    expect(committed.jobs).toContainEqual(localJob);
    expect(recoveredJob?.id).not.toBe("job-1");
    expect(committed.savedCalcs[0].jobId).toBe(recoveredJob?.id);
    expect(result.jobsAdded).toBe(1);
    expect(result.jobsUpdated).toBe(0);
  });

  it("creates a backup that round-trips after future local timestamps", () => {
    mocks.getLocalDataSnapshot.mockReturnValue({
      jobs: [{ ...validBackup.jobs[0], createdAt: 900, updatedAt: 1_000 }],
      savedCalcs: [],
      deletedJobs: [],
      deletedCalcs: [],
    });

    const backup = createBackup(500);

    expect(backup.jobs[0]).toEqual({
      ...validBackup.jobs[0],
      createdAt: 500,
      updatedAt: 500,
    });
    expect(parseBackup(JSON.stringify(backup), 500)).toEqual(backup);
  });

  it.each([
    ["malformed JSON", "{"],
    ["unknown version", JSON.stringify({ ...validBackup, version: 2 })],
    [
      "orphan calculation",
      JSON.stringify({ ...validBackup, jobs: [] }),
    ],
    [
      "duplicate job IDs",
      JSON.stringify({ ...validBackup, jobs: [...validBackup.jobs, ...validBackup.jobs] }),
    ],
    [
      "active and deleted job",
      JSON.stringify({
        ...validBackup,
        tombstones: { jobs: [{ id: "job-1", updatedAt: 300 }], savedCalcs: [] },
      }),
    ],
    [
      "active and deleted calculation",
      JSON.stringify({
        ...validBackup,
        tombstones: {
          jobs: [],
          savedCalcs: [{ id: "calc-1", updatedAt: 300 }],
        },
      }),
    ],
    [
      "unsafe calculation path",
      JSON.stringify({
        ...validBackup,
        savedCalcs: [{ ...validBackup.savedCalcs[0], path: "//example.com" }],
      }),
    ],
    [
      "mismatched calculator path",
      JSON.stringify({
        ...validBackup,
        savedCalcs: [{ ...validBackup.savedCalcs[0], path: "/ampacity" }],
      }),
    ],
    [
      "unsafe calculator state",
      JSON.stringify({
        ...validBackup,
        savedCalcs: [{ ...validBackup.savedCalcs[0], state: { amps: 20 } }],
      }),
    ],
    [
      "invalid item timeline",
      JSON.stringify({
        ...validBackup,
        jobs: [{ ...validBackup.jobs[0], createdAt: 300, updatedAt: 200 }],
      }),
    ],
    [
      "future export timestamp",
      JSON.stringify({
        ...validBackup,
        exportedAt: Number.MAX_SAFE_INTEGER,
      }),
    ],
    [
      "whitespace-only ID",
      JSON.stringify({
        ...validBackup,
        jobs: [{ ...validBackup.jobs[0], id: "   " }],
      }),
    ],
  ])("rejects %s without changing local data", (_label, text) => {
    expect(() => parseBackup(text)).toThrow("not a valid Codewire backup");
    expect(mocks.commitLocalDataSnapshot).not.toHaveBeenCalled();
  });
});
