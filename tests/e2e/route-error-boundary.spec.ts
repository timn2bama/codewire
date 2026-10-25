import { expect, test } from "@playwright/test";

// A throw during render used to unmount the tree: no heading, no text, empty
// #root, so the user saw a blank page with no explanation and no way back. The
// calculators no longer throw on bad stored state (tests/e2e/
// persisted-state-validation.spec.ts), but nothing stopped the NEXT render throw
// - a failed lazy-chunk load after a deploy is the obvious one - from blanking
// the page again. /__error-probe only exists in the e2e build (VITE_E2E=1).
test("a render throw shows an explanation instead of a blank page", async ({
  page,
}) => {
  const logged: string[] = [];
  page.on("console", (msg) => logged.push(msg.text()));

  await page.goto("/__error-probe");

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /couldn't load/i }),
  ).toBeVisible();
  await expect(alert).toContainText(/nothing you saved has been lost/i);

  // The two ways out are both present and big enough to tap.
  const reload = page.getByRole("button", { name: /reload the page/i });
  const back = page.getByRole("link", { name: /back to all calculators/i });
  await expect(reload).toBeVisible();
  await expect(back).toBeVisible();
  for (const target of [reload, back]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // The document still has content and a landmark: it is not a blank page.
  expect(
    (await page.locator("body").innerText()).trim().length,
  ).toBeGreaterThan(40);
  await expect(page.locator("main")).toHaveCount(1);

  // componentDidCatch reported the failure rather than swallowing it silently.
  expect(logged.join(" ")).toContain("route render failed");

  // Navigating away clears the error rather than leaving the app stuck.
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});
