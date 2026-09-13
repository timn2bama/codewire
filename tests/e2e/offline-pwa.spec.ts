import { expect, test } from "@playwright/test";

test("opens and calculates from the installed PWA while offline", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are not supported");
    }
    await navigator.serviceWorker.ready;
  });

  // A first-load service worker takes control after the next navigation.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.goto("/ampacity", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Wire Ampacity" }),
    ).toBeVisible();

    await page.getByLabel("Load (optional)").fill("40");
    await expect(page.getByText("< 40 A", { exact: true })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
