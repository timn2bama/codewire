import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDataSnapshot } from "./jobs";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  failOnceOnKey: string | null = null;
  setItemCalls = 0;
  afterSetItem: ((key: string, value: string) => void) | null = null;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.failOnceOnKey === key) {
      this.failOnceOnKey = null;
      throw new Error("storage full");
    }
    this.setItemCalls += 1;
    this.values.set(key, value);
    const afterSetItem = this.afterSetItem;
    this.afterSetItem = null;
    afterSetItem?.(key, value);
  }
}

const emptySnapshot = (): LocalDataSnapshot => ({
  jobs: [],
  savedCalcs: [],
  deletedJobs: [],
  deletedCalcs: [],
});

describe("atomic local data snapshots", () => {
  let storage: MemoryStorage;
  let storageListeners: Array<(event: StorageEvent) => void>;

  beforeEach(() => {
    vi.resetModules();
    storage = new MemoryStorage();
    storageListeners = [];
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      addEventListener: vi.fn(
        (type: string, listener: (event: StorageEvent) => void) => {
          if (type === "storage") storageListeners.push(listener);
        },
      ),
    });
    let lockTail = Promise.resolve();
    vi.stubGlobal("navigator", {
      locks: {
        request: async <T>(
          _name: string,
          _options: LockOptions,
          callback: () => T | PromiseLike<T>,
        ): Promise<T> => {
          const previous = lockTail;
          let release!: () => void;
          lockTail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          try {
            return await callback();
          } finally {
            release();
          }
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes one event after all four collections are committed", async () => {
    const jobs = await import("./jobs");
    const next: LocalDataSnapshot = {
      jobs: [{ id: "job-1", name: "Kitchen", createdAt: 1, updatedAt: 2 }],
      savedCalcs: [
        {
          id: "calc-1",
          jobId: "job-1",
          calculatorId: "voltage-drop",
          path: "/voltage-drop",
          title: "Dishwasher",
          summary: "20 A",
          result: "3%",
          state: {},
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      deletedJobs: [{ id: "old-job", updatedAt: 3 }],
      deletedCalcs: [{ id: "old-calc", updatedAt: 3 }],
    };
    let observed: LocalDataSnapshot | null = null;
    const listener = vi.fn(() => {
      observed = jobs.getLocalDataSnapshot();
    });
    jobs.subscribe(listener);

    expect(jobs.commitLocalDataSnapshot(next)).toBe(true);

    expect(listener).toHaveBeenCalledOnce();
    expect(observed).toEqual(next);
  });

  it("emits once for a tombstone-only change and not for a no-op", async () => {
    const jobs = await import("./jobs");
    const listener = vi.fn();
    jobs.subscribe(listener);

    expect(
      jobs.commitLocalDataSnapshot({
        ...emptySnapshot(),
        deletedJobs: [{ id: "job-1", updatedAt: 4 }],
      }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    expect(jobs.commitLocalDataSnapshot(jobs.getLocalDataSnapshot())).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rolls storage back and emits nothing when a write fails", async () => {
    const original: LocalDataSnapshot = {
      ...emptySnapshot(),
      jobs: [{ id: "job-1", name: "Original", createdAt: 1, updatedAt: 1 }],
    };
    storage.setItem("cw:jobs", JSON.stringify(original.jobs));
    storage.setItem("cw:saved-calcs", "[]");
    storage.setItem("cw:deleted-jobs", "[]");
    storage.setItem("cw:deleted-calcs", "[]");
    const jobs = await import("./jobs");
    const listener = vi.fn();
    jobs.subscribe(listener);
    expect(jobs.getLocalDataSnapshot()).toEqual(original);
    storage.failOnceOnKey = "cw:data-v1";

    expect(() =>
      jobs.commitLocalDataSnapshot({
        ...original,
        jobs: [{ ...original.jobs[0], name: "Changed", updatedAt: 2 }],
        deletedJobs: [{ id: "old-job", updatedAt: 2 }],
      }),
    ).toThrow("storage full");

    expect(listener).not.toHaveBeenCalled();
    expect(jobs.getLocalDataSnapshot()).toEqual(original);
    expect(JSON.parse(storage.getItem("cw:jobs") ?? "null")).toEqual(
      original.jobs,
    );
  });

  it("invalidates a stale cache after another tab writes the active snapshot", async () => {
    const jobs = await import("./jobs");
    jobs.commitLocalDataSnapshot(emptySnapshot());
    const listener = vi.fn();
    jobs.subscribe(listener);
    const otherTabSnapshot: LocalDataSnapshot = {
      ...emptySnapshot(),
      jobs: [{ id: "job-2", name: "Other tab", createdAt: 1, updatedAt: 2 }],
    };
    storage.setItem("cw:data-v1", JSON.stringify(otherTabSnapshot));

    storageListeners[0]?.({
      key: "cw:data-v1",
      newValue: JSON.stringify(otherTabSnapshot),
    } as StorageEvent);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledOnce();
    expect(jobs.getLocalDataSnapshot()).toEqual(otherTabSnapshot);
  });

  it("isolates account data and requires an explicit guest-data claim", async () => {
    const jobs = await import("./jobs");
    const guestJob = {
      id: "guest-job",
      name: "Guest",
      createdAt: 1,
      updatedAt: 1,
    };
    jobs.commitLocalDataSnapshot({ ...emptySnapshot(), jobs: [guestJob] });

    jobs.setLocalDataScope("account-a");
    expect(jobs.getAllJobs()).toEqual([]);
    expect(jobs.getUnclaimedLocalDataSummary()).toEqual({
      jobs: 1,
      savedCalcs: 0,
      deletedItems: 0,
    });
    await jobs.claimUnassignedLocalData();
    expect(jobs.getAllJobs()).toEqual([guestJob]);
    expect(storage.getItem("cw:unassigned-claimed")).not.toBeNull();
    expect(storage.getItem("cw:data-v1:user:account-a")).not.toBeNull();

    const accountAJob = {
      id: "account-a-job",
      name: "Account A",
      createdAt: 2,
      updatedAt: 2,
    };
    jobs.commitLocalDataSnapshot({
      ...jobs.getLocalDataSnapshot(),
      jobs: [accountAJob, ...jobs.getAllJobs()],
    });
    jobs.setLocalDataScope(null);
    expect(jobs.getAllJobs()).toEqual([]);

    const guestForB = {
      id: "guest-b-job",
      name: "Guest B",
      createdAt: 3,
      updatedAt: 3,
    };
    jobs.commitLocalDataSnapshot({ ...emptySnapshot(), jobs: [guestForB] });
    jobs.setLocalDataScope("account-b");
    expect(jobs.getAllJobs()).toEqual([]);
    await jobs.claimUnassignedLocalData();
    expect(jobs.getAllJobs()).toEqual([guestForB]);

    jobs.setLocalDataScope("account-a");
    expect(jobs.getAllJobs().map((job) => job.id)).toEqual([
      "account-a-job",
      "guest-job",
    ]);
  });

  it("never applies unassigned tombstones to account data", async () => {
    const jobs = await import("./jobs");
    jobs.commitLocalDataSnapshot({
      ...emptySnapshot(),
      deletedJobs: [{ id: "shared", updatedAt: 200 }],
    });
    jobs.setLocalDataScope("account-a");
    jobs.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [{ id: "shared", name: "Account", createdAt: 100, updatedAt: 100 }],
    });

    await jobs.claimUnassignedLocalData();

    expect(jobs.getAllJobs()).toEqual([
      { id: "shared", name: "Account", createdAt: 100, updatedAt: 100 },
    ]);
    expect(jobs.getDeletedJobMarkers()).toEqual([]);
  });

  it("re-keys conflicting unassigned records instead of replacing account data", async () => {
    const jobs = await import("./jobs");
    jobs.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [{ id: "shared", name: "Guest", createdAt: 1, updatedAt: 200 }],
    });
    jobs.setLocalDataScope("account-a");
    jobs.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [{ id: "shared", name: "Account", createdAt: 1, updatedAt: 100 }],
    });

    await jobs.claimUnassignedLocalData();

    expect(jobs.getAllJobs()).toHaveLength(2);
    expect(jobs.getAllJobs()).toEqual(
      expect.arrayContaining([
        { id: "shared", name: "Account", createdAt: 1, updatedAt: 100 },
        expect.objectContaining({ name: "Guest", updatedAt: 200 }),
      ]),
    );
    expect(
      jobs.getAllJobs().find((job) => job.name === "Guest")?.id,
    ).not.toBe("shared");
  });

  it("treats an explicit claim as authoritative in another guest tab", async () => {
    const tabA = await import("./jobs");
    const claimedJob = {
      id: "claimed-job",
      name: "Claimed",
      createdAt: 1,
      updatedAt: 1,
    };
    tabA.commitLocalDataSnapshot({ ...emptySnapshot(), jobs: [claimedJob] });

    vi.resetModules();
    const tabB = await import("./jobs");
    expect(tabB.getAllJobs()).toEqual([claimedJob]);

    tabA.setLocalDataScope("account-a");
    await tabA.claimUnassignedLocalData();
    const claimToken = storage.getItem("cw:unassigned-claimed");
    storageListeners[1]?.({
      key: "cw:unassigned-claimed",
      newValue: claimToken,
    } as StorageEvent);
    await Promise.resolve();

    expect(tabB.getAllJobs()).toEqual([]);
    const newGuestJob = {
      id: "new-guest-job",
      name: "New guest",
      createdAt: 2,
      updatedAt: 2,
    };
    tabB.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [newGuestJob],
    });
    expect(tabB.getAllJobs()).toEqual([newGuestJob]);
    expect(storage.getItem("cw:unassigned-claimed")).toBe(claimToken);
  });

  it("allows only one account to claim the same unassigned snapshot", async () => {
    const tabA = await import("./jobs");
    tabA.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [{ id: "guest-job", name: "Guest", createdAt: 1, updatedAt: 1 }],
    });
    vi.resetModules();
    const tabB = await import("./jobs");
    tabA.setLocalDataScope("account-a");
    tabB.setLocalDataScope("account-b");

    const [claimedByA, claimedByB] = await Promise.all([
      tabA.claimUnassignedLocalData(),
      tabB.claimUnassignedLocalData(),
    ]);

    expect(claimedByA).toBe(true);
    expect(claimedByB).toBe(false);
    expect(tabA.getAllJobs()).toHaveLength(1);
    expect(tabB.getAllJobs()).toEqual([]);
  });

  it("does not remove a newer claim marker during a concurrent guest write", async () => {
    const guestTab = await import("./jobs");
    guestTab.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [{ id: "old", name: "Old", createdAt: 1, updatedAt: 1 }],
    });
    vi.resetModules();
    const accountTab = await import("./jobs");
    accountTab.setLocalDataScope("account-a");
    await accountTab.claimUnassignedLocalData();
    const firstMarker = storage.getItem("cw:unassigned-claimed");
    storageListeners[0]?.({
      key: "cw:unassigned-claimed",
      newValue: firstMarker,
    } as StorageEvent);
    const next = {
      ...emptySnapshot(),
      jobs: [{ id: "new", name: "New", createdAt: 2, updatedAt: 2 }],
    };
    const { canonicalFingerprint, canonicalSerialize } = await import("./recoveryIds");
    const secondMarker = canonicalSerialize({
      token: "second",
      scope: "user:account-b",
      fingerprint: canonicalFingerprint(next),
    });
    storage.afterSetItem = (key) => {
      if (key === "cw:data-v1")
        storage.setItem("cw:unassigned-claimed", secondMarker);
    };

    guestTab.commitLocalDataSnapshot(next);

    expect(storage.getItem("cw:unassigned-claimed")).toBe(secondMarker);
  });

  it("does not partially copy data when the claim marker cannot be saved", async () => {
    const jobs = await import("./jobs");
    jobs.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [{ id: "guest-job", name: "Guest", createdAt: 1, updatedAt: 1 }],
    });
    jobs.setLocalDataScope("account-a");
    storage.failOnceOnKey = "cw:unassigned-claimed";

    await expect(jobs.claimUnassignedLocalData()).rejects.toThrow("storage full");
    expect(jobs.getAllJobs()).toEqual([]);
    expect(storage.getItem("cw:data-v1:user:account-a")).toBeNull();

    await expect(jobs.claimUnassignedLocalData()).resolves.toBe(true);
    expect(jobs.getAllJobs()).toHaveLength(1);
  });

  it("keeps new guest work visible when it differs from the claimed snapshot", async () => {
    const jobs = await import("./jobs");
    jobs.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [{ id: "old", name: "Old", createdAt: 1, updatedAt: 1 }],
    });
    jobs.setLocalDataScope("account-a");
    await jobs.claimUnassignedLocalData();
    const newGuest = {
      ...emptySnapshot(),
      jobs: [{ id: "new", name: "New", createdAt: 2, updatedAt: 2 }],
    };
    const serialized = JSON.stringify(newGuest);
    storage.setItem("cw:data-v1", serialized);
    storageListeners[0]?.({ key: "cw:data-v1", newValue: serialized } as StorageEvent);

    expect(jobs.getUnclaimedLocalDataSummary()).toEqual({
      jobs: 1,
      savedCalcs: 0,
      deletedItems: 0,
    });
  });

  it("canonicalizes record and tombstone order before persistence", async () => {
    const jobs = await import("./jobs");
    const a = { id: "a", name: "A", createdAt: 1, updatedAt: 1 };
    const b = { id: "b", name: "B", createdAt: 1, updatedAt: 1 };
    jobs.commitLocalDataSnapshot({
      ...emptySnapshot(),
      jobs: [b, a],
      deletedCalcs: [
        { id: "b", updatedAt: 2 },
        { id: "a", updatedAt: 2 },
      ],
    });
    const canonical = storage.getItem("cw:data-v1");

    expect(
      jobs.commitLocalDataSnapshot({
        ...emptySnapshot(),
        jobs: [a, b],
        deletedCalcs: [
          { id: "a", updatedAt: 2 },
          { id: "b", updatedAt: 2 },
        ],
      }),
    ).toBe(false);
    expect(storage.getItem("cw:data-v1")).toBe(canonical);
    expect(canonical).toContain(
      '{"createdAt":1,"id":"a","name":"A","updatedAt":1}',
    );
  });

  it("converges when equal records use different object property order", async () => {
    const rowA = { id: "same", name: "Same", createdAt: 1, updatedAt: 1 };
    const rowB = { updatedAt: 1, createdAt: 1, name: "Same", id: "same" };
    const rawA = JSON.stringify({ ...emptySnapshot(), jobs: [rowA] });
    const rawB = JSON.stringify({ ...emptySnapshot(), jobs: [rowB] });
    storage.setItem("cw:data-v1", rawA);
    const tabA = await import("./jobs");
    tabA.getAllJobs();

    storage.setItem("cw:data-v1", rawB);
    vi.resetModules();
    const tabB = await import("./jobs");
    tabB.getAllJobs();

    storageListeners[0]?.({ key: "cw:data-v1", newValue: rawB } as StorageEvent);
    const canonical = storage.getItem("cw:data-v1");
    const writesAfterCanonical = storage.setItemCalls;
    storageListeners[1]?.({
      key: "cw:data-v1",
      newValue: canonical,
    } as StorageEvent);
    storageListeners[0]?.({
      key: "cw:data-v1",
      newValue: canonical,
    } as StorageEvent);

    expect(storage.setItemCalls).toBe(writesAfterCanonical);
    expect(tabA.getAllJobs()).toEqual([rowA]);
    expect(tabB.getAllJobs()).toEqual([rowB]);
  });

  it("reconciles simultaneous full-snapshot writes from two tabs", async () => {
    const tabA = await import("./jobs");
    tabA.commitLocalDataSnapshot(emptySnapshot());
    expect(tabA.getAllJobs()).toEqual([]);

    vi.resetModules();
    const tabB = await import("./jobs");
    expect(tabB.getAllJobs()).toEqual([]);

    const jobA = { id: "job-a", name: "A", createdAt: 1, updatedAt: 1 };
    const jobB = { id: "job-b", name: "B", createdAt: 2, updatedAt: 2 };
    tabA.commitLocalDataSnapshot({ ...emptySnapshot(), jobs: [jobA] });
    tabB.commitLocalDataSnapshot({ ...emptySnapshot(), jobs: [jobB] });
    const tabBWrite = storage.getItem("cw:data-v1");

    storageListeners[0]?.({
      key: "cw:data-v1",
      newValue: tabBWrite,
    } as StorageEvent);
    const reconciled = storage.getItem("cw:data-v1");
    storageListeners[1]?.({
      key: "cw:data-v1",
      newValue: reconciled,
    } as StorageEvent);
    await Promise.resolve();

    expect(tabA.getAllJobs().map((job) => job.id).sort()).toEqual([
      "job-a",
      "job-b",
    ]);
    expect(tabB.getAllJobs().map((job) => job.id).sort()).toEqual([
      "job-a",
      "job-b",
    ]);
  });

  it("preserves writes from a pre-update tab as unassigned data", async () => {
    const jobs = await import("./jobs");
    jobs.commitLocalDataSnapshot(emptySnapshot());
    jobs.setLocalDataScope("account-a");
    const legacyJob = {
      id: "legacy-job",
      name: "Legacy tab",
      createdAt: 4,
      updatedAt: 4,
    };
    storage.setItem("cw:jobs", JSON.stringify([legacyJob]));

    storageListeners[0]?.({
      key: "cw:jobs",
      newValue: JSON.stringify([legacyJob]),
    } as StorageEvent);
    await Promise.resolve();

    expect(jobs.getAllJobs()).toEqual([]);
    expect(jobs.getUnclaimedLocalDataSummary()?.jobs).toBe(1);
    await jobs.claimUnassignedLocalData();
    expect(jobs.getAllJobs()).toEqual([legacyJob]);
  });

  it("cascades a restored job tombstone to its local calculations", async () => {
    const jobs = await import("./jobs");
    jobs.commitLocalDataSnapshot({
      jobs: [{ id: "job-1", name: "Old", createdAt: 1, updatedAt: 2 }],
      savedCalcs: [
        {
          id: "calc-1",
          jobId: "job-1",
          calculatorId: "box-fill",
          path: "/box-fill",
          title: "Old calc",
          summary: "",
          result: "",
          state: {},
          createdAt: 1,
          updatedAt: 3,
        },
      ],
      deletedJobs: [],
      deletedCalcs: [],
    });

    jobs.applyCloudData([], [], [{ id: "job-1", updatedAt: 4 }], []);

    expect(jobs.getAllJobs()).toEqual([]);
    expect(jobs.getAllCalcs()).toEqual([]);
    expect(jobs.getDeletedCalcMarkers()).toEqual([
      { id: "calc-1", updatedAt: 4 },
    ]);
  });
});
