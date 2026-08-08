import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  applyCloudData: vi.fn(),
  getAllJobs: vi.fn(() => []),
  getAllCalcs: vi.fn(() => []),
  getDeletedJobMarkers: vi.fn(
    (): Array<{ id: string; updatedAt: number }> => [],
  ),
  getDeletedCalcMarkers: vi.fn(
    (): Array<{ id: string; updatedAt: number }> => [],
  ),
}));

vi.mock("./supabase", () => ({
  supabase: { from: mocks.from },
}));

vi.mock("./jobs", () => ({
  applyCloudData: mocks.applyCloudData,
  getAllJobs: mocks.getAllJobs,
  getAllCalcs: mocks.getAllCalcs,
  getDeletedJobMarkers: mocks.getDeletedJobMarkers,
  getDeletedCalcMarkers: mocks.getDeletedCalcMarkers,
  subscribe: vi.fn(() => vi.fn()),
}));

import { pull, push } from "./cloudSync";

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
  });

  it("does not apply a partial snapshot when either cloud read fails", async () => {
    const failure = new Error("network unavailable");
    mocks.from
      .mockReturnValueOnce(selectResult({ data: null, error: failure }))
      .mockReturnValueOnce(selectResult({ data: [], error: null }));

    await expect(pull()).rejects.toBe(failure);
    expect(mocks.applyCloudData).not.toHaveBeenCalled();
  });

  it("does not delete cloud rows when the local device is empty", async () => {
    await push("user-1");

    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("propagates only explicit tombstones for deletes", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    mocks.getDeletedJobMarkers.mockReturnValue([{ id: "job-1", updatedAt: 200 }]);
    mocks.from.mockReturnValue({ update });

    await push("user-1");

    expect(mocks.from).toHaveBeenCalledWith("jobs");
    expect(update).toHaveBeenCalledWith({ deleted: true, updated_at: 200 });
    expect(eq).toHaveBeenCalledWith("id", "job-1");
  });
});
