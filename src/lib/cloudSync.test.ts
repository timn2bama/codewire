import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, SavedCalc } from "./jobs";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  applyCloudData: vi.fn(),
  getAllJobs: vi.fn<() => Job[]>(() => []),
  getAllCalcs: vi.fn<() => SavedCalc[]>(() => []),
  getDeletedJobMarkers: vi.fn(
    (): Array<{ id: string; updatedAt: number }> => [],
  ),
  getDeletedCalcMarkers: vi.fn(
    (): Array<{ id: string; updatedAt: number }> => [],
  ),
}));

vi.mock("./supabase", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

vi.mock("./jobs", () => ({
  applyCloudData: mocks.applyCloudData,
  getAllJobs: mocks.getAllJobs,
  getAllCalcs: mocks.getAllCalcs,
  getDeletedJobMarkers: mocks.getDeletedJobMarkers,
  getDeletedCalcMarkers: mocks.getDeletedCalcMarkers,
  subscribe: vi.fn(() => vi.fn()),
}));

import { createSyncController, pull, push } from "./cloudSync";

function selectResult(result: { data: unknown[] | null; error: unknown }) {
  return {
    select: vi.fn().mockResolvedValue(result),
  };
}

describe("cloud sync safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllJobs.mockReturnValue([]);
    mocks.getAllCalcs.mockReturnValue([]);
    mocks.getDeletedJobMarkers.mockReturnValue([]);
    mocks.getDeletedCalcMarkers.mockReturnValue([]);
    mocks.rpc.mockResolvedValue({
      data: { jobs: [], saved_calcs: [] },
      error: null,
    });
  });

  it("does not apply a partial snapshot when either cloud read fails", async () => {
    const failure = new Error("network unavailable");
    mocks.from
      .mockReturnValueOnce(selectResult({ data: null, error: failure }))
      .mockReturnValueOnce(selectResult({ data: [], error: null }));

    await expect(pull()).rejects.toBe(failure);
    expect(mocks.applyCloudData).not.toHaveBeenCalled();
  });

  it("does not apply a completed pull after its session becomes stale", async () => {
    mocks.from
      .mockReturnValueOnce(selectResult({ data: [], error: null }))
      .mockReturnValueOnce(selectResult({ data: [], error: null }));

    await pull(() => false);

    expect(mocks.applyCloudData).not.toHaveBeenCalled();
  });

  it("syncs an empty device without issuing blind table writes", async () => {
    await push("user-1");

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("sync_codewire", {
      p_job_rows: [],
      p_calc_rows: [],
    });
  });

  it("propagates explicit tombstones through conflict-safe sync rows", async () => {
    mocks.getDeletedJobMarkers.mockReturnValue([{ id: "job-1", updatedAt: 200 }]);

    await push("user-1");

    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_codewire",
      expect.objectContaining({
        p_job_rows: [
          expect.objectContaining({
            id: "job-1",
            updated_at: 200,
            deleted: true,
          }),
        ],
      }),
    );
  });

  it("rejects malformed local calculator state before writing it to cloud", async () => {
    mocks.getAllCalcs.mockReturnValue([
      {
        id: "calc-1",
        jobId: "job-1",
        calculatorId: "conduit-fill",
        path: "/conduit-fill",
        title: "Bad state",
        summary: "",
        result: "",
        state: { type: "UNKNOWN" },
        createdAt: 100,
        updatedAt: 100,
      },
    ]);

    await expect(push("user-1")).rejects.toThrow("not a valid Codewire backup");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed cloud calculator state without applying it locally", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        jobs: [],
        saved_calcs: [
          {
            id: "calc-1",
            user_id: "user-1",
            job_id: "job-1",
            calculator_id: "conduit-fill",
            path: "/conduit-fill",
            title: "Bad state",
            summary: "",
            result: "",
            state: { type: "UNKNOWN" },
            created_at: 100,
            updated_at: 100,
            deleted: false,
          },
        ],
      },
      error: null,
    });

    await expect(push("user-1")).rejects.toThrow("not a valid Codewire backup");
    expect(mocks.applyCloudData).not.toHaveBeenCalled();
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("serialized sync controller", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(
    pullImpl: (shouldApply?: () => boolean) => Promise<void> = async () => {},
    pushImpl: (
      userId: string,
      shouldApply?: () => boolean,
    ) => Promise<void> = async () => {},
  ) {
    let localChange: (() => void) | null = null;
    const unsubscribe = vi.fn();
    const dependencies = {
      pull: vi.fn(pullImpl),
      push: vi.fn(pushImpl),
      subscribe: vi.fn((callback: () => void) => {
        localChange = callback;
        return unsubscribe;
      }),
    };
    const callbacks = {
      onPending: vi.fn(),
      onStart: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };
    const controller = createSyncController(
      "user-1",
      callbacks,
      25,
      dependencies,
    );
    return {
      callbacks,
      controller,
      dependencies,
      emitLocalChange: () => localChange?.(),
      unsubscribe,
    };
  }

  it("subscribes before initial sync and reports pull failures", async () => {
    const failure = new Error("network unavailable");
    const context = setup(async () => Promise.reject(failure));

    expect(context.dependencies.subscribe).toHaveBeenCalledOnce();
    await expect(context.controller.initialSync()).rejects.toBe(failure);

    expect(context.dependencies.push).not.toHaveBeenCalled();
    expect(context.callbacks.onStart).toHaveBeenCalledOnce();
    expect(context.callbacks.onSuccess).not.toHaveBeenCalled();
    expect(context.callbacks.onError).toHaveBeenCalledWith(failure);
  });

  it("uploads an edit made during the initial push before reporting success", async () => {
    const firstPush = deferred();
    let calls = 0;
    let concurrency = 0;
    let maxConcurrency = 0;
    const context = setup(undefined, async () => {
      calls += 1;
      concurrency += 1;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      if (calls === 1) await firstPush.promise;
      concurrency -= 1;
    });

    const initial = context.controller.initialSync();
    await flushMicrotasks();
    expect(context.dependencies.push).toHaveBeenCalledOnce();

    context.emitLocalChange();
    firstPush.resolve();
    await initial;

    expect(context.dependencies.push).toHaveBeenCalledTimes(2);
    expect(maxConcurrency).toBe(1);
    expect(context.callbacks.onSuccess).toHaveBeenCalledOnce();
  });

  it("debounces rapid edits into one automatic push", async () => {
    vi.useFakeTimers();
    const context = setup();
    await context.controller.initialSync();
    context.dependencies.push.mockClear();

    context.emitLocalChange();
    context.emitLocalChange();
    context.emitLocalChange();
    expect(context.callbacks.onPending).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();

    expect(context.dependencies.push).toHaveBeenCalledOnce();
  });

  it("serializes a follow-up edit while an automatic push is running", async () => {
    vi.useFakeTimers();
    const firstAutoPush = deferred();
    let automaticCalls = 0;
    let concurrency = 0;
    let maxConcurrency = 0;
    const context = setup(undefined, async () => {
      automaticCalls += 1;
      if (automaticCalls === 1) return;
      concurrency += 1;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      if (automaticCalls === 2) await firstAutoPush.promise;
      concurrency -= 1;
    });
    await context.controller.initialSync();

    context.emitLocalChange();
    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();
    expect(context.dependencies.push).toHaveBeenCalledTimes(2);

    context.emitLocalChange();
    await vi.advanceTimersByTimeAsync(25);
    firstAutoPush.resolve();
    await flushMicrotasks();

    expect(context.dependencies.push).toHaveBeenCalledTimes(3);
    expect(maxConcurrency).toBe(1);
  });

  it("deduplicates simultaneous full retries", async () => {
    const retryPull = deferred();
    let pulls = 0;
    const context = setup(async () => {
      pulls += 1;
      if (pulls === 2) await retryPull.promise;
    });
    await context.controller.initialSync();

    const first = context.controller.retry();
    const second = context.controller.retry();
    expect(second).toBe(first);
    retryPull.resolve();
    await first;

    expect(context.dependencies.pull).toHaveBeenCalledTimes(2);
  });

  it("keeps automatic pushing gated after a failed full retry", async () => {
    vi.useFakeTimers();
    const failure = new Error("pull failed");
    const context = setup();
    await context.controller.initialSync();
    context.dependencies.push.mockClear();
    context.dependencies.pull.mockRejectedValueOnce(failure);

    await expect(context.controller.retry()).rejects.toBe(failure);
    context.emitLocalChange();
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    expect(context.dependencies.push).not.toHaveBeenCalled();
    expect(context.callbacks.onError).toHaveBeenCalledWith(failure);

    await context.controller.retry();
    expect(context.dependencies.pull).toHaveBeenCalledTimes(3);
    expect(context.dependencies.push).toHaveBeenCalledOnce();
  });

  it("queues a fresh full sync when reconnect happens during a failing one", async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    });
    const failingPull = deferred();
    let pulls = 0;
    const context = setup(async () => {
      pulls += 1;
      if (pulls === 2) await failingPull.promise;
    });
    await context.controller.initialSync();

    const retry = context.controller.retry();
    await flushMicrotasks();
    listeners.get("online")?.();
    failingPull.reject(new Error("old request failed"));
    await expect(retry).rejects.toThrow("old request failed");
    await flushMicrotasks();

    expect(context.dependencies.pull).toHaveBeenCalledTimes(3);
  });

  it("stops pending work and suppresses late callbacks", async () => {
    const pendingPull = deferred();
    const applied = vi.fn();
    const context = setup(async (shouldApply) => {
      await pendingPull.promise;
      if (shouldApply?.()) applied();
    });

    const initial = context.controller.initialSync();
    await flushMicrotasks();
    context.controller.stop();
    pendingPull.resolve();
    await initial;

    expect(applied).not.toHaveBeenCalled();
    expect(context.dependencies.push).not.toHaveBeenCalled();
    expect(context.callbacks.onSuccess).not.toHaveBeenCalled();
    expect(context.callbacks.onError).not.toHaveBeenCalled();
    expect(context.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not apply a pull that completes after the browser goes offline", async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    });
    const pendingPull = deferred();
    const applied = vi.fn();
    const context = setup(async (shouldApply) => {
      await pendingPull.promise;
      if (shouldApply?.()) applied();
    });

    const initial = context.controller.initialSync();
    await flushMicrotasks();
    listeners.get("offline")?.();
    pendingPull.resolve();
    await initial;

    expect(applied).not.toHaveBeenCalled();
    expect(context.dependencies.push).not.toHaveBeenCalled();
    expect(context.callbacks.onSuccess).not.toHaveBeenCalled();
  });

  it("does not apply or repeat an in-flight push after going offline", async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    });
    const autoPush = deferred();
    const applyGuards: Array<() => boolean> = [];
    let pushes = 0;
    const context = setup(undefined, async (_userId, shouldApply) => {
      pushes += 1;
      if (pushes === 1) return;
      if (shouldApply) applyGuards.push(shouldApply);
      await autoPush.promise;
    });
    await context.controller.initialSync();
    context.callbacks.onSuccess.mockClear();

    context.emitLocalChange();
    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();
    context.emitLocalChange();
    listeners.get("offline")?.();
    autoPush.resolve();
    await flushMicrotasks();

    expect(applyGuards[0]?.()).toBe(false);
    expect(context.dependencies.push).toHaveBeenCalledTimes(2);
    expect(context.callbacks.onSuccess).not.toHaveBeenCalled();
  });
});
