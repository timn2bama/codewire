import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STATIC_BILLING_FILES = [
  "index.html",
  "public/llms.txt",
  "scripts/prerender.mjs",
] as const;

describe("static billing copy", () => {
  it.each(STATIC_BILLING_FILES)(
    "%s makes trial eligibility explicit",
    (relativePath) => {
      const contents = readFileSync(resolve(process.cwd(), relativePath), "utf8");

      expect(contents).toMatch(
        /eligible first-time subscribers receive a 7-day trial/i,
      );
      expect(contents).not.toMatch(/7-day free trial/i);
    },
  );
});
