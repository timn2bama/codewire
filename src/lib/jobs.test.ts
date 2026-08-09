import { describe, expect, it } from "vitest";
import { mergeByUpdatedAt, mergeWithTombstones, FREE_JOB_LIMIT } from "./jobs";

type Row = { id: string; updatedAt: number; createdAt: number; v: string };
const row = (id: string, updatedAt: number, v: string, createdAt = updatedAt): Row => ({
  id,
  updatedAt,
  createdAt,
  v,
});

describe("cloud sync merge (last-write-wins)", () => {
  it("cloud wins when its updatedAt is newer", () => {
    const local = [row("a", 100, "local")];
    const cloud = [row("a", 200, "cloud")];
    const merged = mergeByUpdatedAt(local, cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0].v).toBe("cloud");
  });

  it("local wins when it is newer", () => {
    const merged = mergeByUpdatedAt(
      [row("a", 300, "local")],
      [row("a", 200, "cloud")],
    );
    expect(merged[0].v).toBe("local");
  });

  it("unions ids present on only one side", () => {
    const merged = mergeByUpdatedAt(
      [row("a", 1, "local-a")],
      [row("b", 1, "cloud-b")],
    );
    expect(merged.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("sorts newest-created first", () => {
    const merged = mergeByUpdatedAt(
      [row("old", 1, "x", 1), row("new", 2, "y", 5)],
      [],
    );
    expect(merged.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("resolves equal-timestamp cross-tab edits deterministically", () => {
    const left = [row("a", 100, "left")];
    const right = [row("a", 100, "right")];

    expect(mergeByUpdatedAt(left, right, false, true)).toEqual(
      mergeByUpdatedAt(right, left, false, true),
    );
  });

  it("free job limit is 2", () => {
    expect(FREE_JOB_LIMIT).toBe(2);
  });

  it("keeps a newer tombstone instead of resurrecting an older item", () => {
    const result = mergeWithTombstones(
      [],
      [row("a", 100, "cloud")],
      [{ id: "a", updatedAt: 200 }],
      [],
    );
    expect(result.items).toEqual([]);
    expect(result.tombstones).toEqual([{ id: "a", updatedAt: 200 }]);
  });

  it("allows a newer active edit to supersede an old tombstone", () => {
    const result = mergeWithTombstones(
      [row("a", 300, "local")],
      [],
      [],
      [{ id: "a", updatedAt: 200 }],
    );
    expect(result.items[0].v).toBe("local");
    expect(result.tombstones).toEqual([]);
  });
});
