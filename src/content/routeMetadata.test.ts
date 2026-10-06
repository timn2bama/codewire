import { describe, expect, it } from "vitest";
import routeMetadata from "./routeMetadata.json";

interface RouteMetadataEntry {
  path: string;
  title: string;
  description: string;
}

const entries = routeMetadata as RouteMetadataEntry[];

// Routes rendered by src/App.tsx that serve their own page and therefore need
// their own <title>/description. "/" is handled by HOME_METADATA in
// src/components/RouteMetadata.tsx, and /jobs/:id, /jobs/:id/report are
// dynamic, so neither belongs in this list.
const REQUIRED_PATHS = [
  "/terms",
  "/privacy",
  "/jobs",
  "/login",
  "/account",
];

describe("routeMetadata content", () => {
  it("has an entry for every public static route that needs one", () => {
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const missing = REQUIRED_PATHS.filter((path) => !byPath.has(path));
    expect(missing, `routes missing route metadata: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("never ships an empty title or description", () => {
    for (const entry of entries) {
      expect(entry.title.trim(), `empty title for ${entry.path}`).not.toBe("");
      expect(
        entry.description.trim(),
        `empty description for ${entry.path}`,
      ).not.toBe("");
    }
  });

  it("uses unique paths and unique titles", () => {
    expect(new Set(entries.map((e) => e.path)).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.title)).size).toBe(entries.length);
  });
});