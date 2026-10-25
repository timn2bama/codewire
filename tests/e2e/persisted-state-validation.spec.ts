import { expect, test } from "@playwright/test";

// Storage written by an older build, restored from a saved calculation
// (JobDetail reopens a calculator with the saved state through loadCalc) or
// synced from another device can name a size or angle this build no longer
// lists. Those values used to reach the calculations: conduit-fill and
// ampacity threw during render and left a blank page, box-fill read the
// unknown conductor as a zero-volume conductor so a box that does not fit was
// reported as "Fits", and conduit-bending rendered a negative distance between
// marks. Every stored value must be repaired before it is used.
const POISONED: Record<string, unknown> = {
  "cw:conduit-fill": {
    type: "EMT",
    tradeSize: '5"',
    conductors: [{ insulation: "THHN", size: "12", quantity: 3 }],
  },
  "cw:box-fill": {
    boxVolume: 18,
    conductors: [{ size: "99", quantity: 4 }],
    devices: 1,
    hasClamps: true,
    groundSize: "12",
  },
  "cw:ampacity": {
    material: "cu",
    size: "99",
    tempRating: 90,
    ambientC: 30,
    currentCarrying: 3,
    terminationRating: 75,
    load: 30,
  },
  "cw:bending": {
    mode: "offset",
    offsetHeight: 6,
    angle: 999,
    saddleDepth: 4,
    saddle4Depth: 3,
    saddle4Angle: 22.5,
    stubHeight: 12,
    takeUpSize: '9"',
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    for (const [key, value] of Object.entries(seed)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }, POISONED);
});

test("an unlisted stored trade size is repaired instead of blanking conduit-fill", async ({
  page,
}) => {
  await page.goto("/conduit-fill");

  // Before the repair the whole page was blank: the unknown trade size threw
  // from the calculation during render.
  await expect(
    page.getByRole("heading", { name: "Conduit Fill" }),
  ).toBeVisible();
  await expect(page.getByText("Within code")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("cw:conduit-fill")!).tradeSize,
      ),
    )
    .toBe('1/2"');
});

test("an unlisted conductor size repairs to the page default, not the smallest listed", async ({
  page,
}) => {
  // The seeded row above is THHN / 12 AWG, so it never exercises the size
  // fallback. Replace it with a size this build does not list: repairing to
  // the first offered size would silently rewrite a 12 AWG circuit to 18 AWG.
  await page.addInitScript(() => {
    localStorage.setItem(
      "cw:conduit-fill",
      JSON.stringify({
        type: "EMT",
        tradeSize: '1/2"',
        conductors: [{ insulation: "THHN", size: "99", quantity: 3 }],
      }),
    );
  });
  await page.goto("/conduit-fill");

  await expect(
    page.getByRole("heading", { name: "Conduit Fill" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cw:conduit-fill")!).conductors[0]
            .size,
      ),
    )
    .toBe("12");
});

test("an unlisted stored conductor size is counted instead of read as zero", async ({
  page,
}) => {
  await page.goto("/box-fill");

  // Four 12 AWG conductors, a 12 AWG EGC, one yoke and clamps in an 18 in³
  // box: 9.00 + 2.25 + 2.25 + 4.50 = 18.00 in³. The unknown size used to be
  // read as zero, so the same box was reported as 4.50 in³ and "Fits".
  await expect(page.getByText("18.00 in³")).toBeVisible();
  await expect(page.getByText("Remaining: 0.00 in³")).toBeVisible();
  await expect(page.getByText("4.50 in³")).toHaveCount(0);
  await expect(page.getByText("Required (box 18 in³)")).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("cw:box-fill")!).conductors[0].size,
      ),
    )
    .toBe("12");
});

test("an unlisted stored wire size is repaired instead of blanking ampacity", async ({
  page,
}) => {
  await page.goto("/ampacity");

  // 10 AWG copper on the 90 °C column is 40 A, capped at the 75 °C
  // termination rating of 35 A (110.14(C)).
  await expect(
    page.getByRole("heading", { name: "Wire Ampacity" }),
  ).toBeVisible();
  await expect(page.getByText("35 A")).toBeVisible();
  await expect(page.getByText("Base: 40 A")).toBeVisible();
});

test("an unlisted stored bend angle is repaired instead of producing a negative mark", async ({
  page,
}) => {
  await page.goto("/conduit-bending");

  // 6" offset at the default 30°: 6 / sin 30° = 12.00". At the stored 999° the
  // same input rendered a −6.07" distance between marks.
  await expect(page.getByText('12.00"')).toBeVisible();
  await expect(page.getByText('-6.07"')).toHaveCount(0);
  await expect(page.getByText(/^Shrink: 1\.61"$/)).toBeVisible();
});
