import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

interface RouteMetadataEntry {
  path: string;
  title: string;
  description: string;
}

const routeMetadata = JSON.parse(
  readFileSync(
    new URL("../../src/content/routeMetadata.json", import.meta.url),
    "utf8",
  ),
) as RouteMetadataEntry[];

async function expectMetadata(
  page: import("@playwright/test").Page,
  expected: { title: string; description: string; canonical: string },
) {
  await expect(page).toHaveTitle(expected.title);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    expected.description,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    expected.canonical,
  );
}

test("syncs all public route metadata after client navigation", async ({
  page,
}) => {
  await page.goto("/");

  for (const metadata of routeMetadata) {
    await page.evaluate((path) => {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, metadata.path);
    await expectMetadata(page, {
      title: metadata.title,
      description: metadata.description,
      canonical: `https://codewire.tools${metadata.path}`,
    });
  }
});

test("keeps route metadata synchronized through client and offline PWA navigation", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Voltage Drop/ }).click();
  await expectMetadata(page, {
    title: "Voltage Drop Calculator (NEC) — Codewire",
    description:
      "Free NEC voltage drop calculator for electricians. Enter wire size, load current, one-way length and voltage to get percent drop, voltage at the load, and the minimum wire size to stay within 3% / 5%.",
    canonical: "https://codewire.tools/voltage-drop",
  });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.goto("/ampacity", { waitUntil: "domcontentloaded" });
    await expectMetadata(page, {
      title: "Wire Ampacity Calculator with Derating (NEC 310.16) — Codewire",
      description:
        "Free NEC wire ampacity calculator. Get allowable ampacity for copper or aluminum with ambient-temperature and conductor-bundling derating and termination limits, or reverse-solve the minimum wire size for a load.",
      canonical: "https://codewire.tools/ampacity",
    });
  } finally {
    await context.setOffline(false);
  }
});
