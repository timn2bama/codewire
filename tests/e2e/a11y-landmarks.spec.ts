import { expect, test } from "@playwright/test";

// Routes a signed-out visitor can render. /account is wrapped in RequireAuth
// and bounces to /login, so it is left out.
const ROUTES = [
  "/",
  "/about",
  "/jobs",
  "/login",
  "/upgrade",
  "/terms",
  "/privacy",
  "/wire-size-chart",
  "/voltage-drop",
  "/ampacity",
  "/conduit-fill",
  "/box-fill",
  "/conduit-bending",
] as const;

// Lighthouse reported "Document does not have a main landmark" on every route
// it measured (axe landmark-one-main). The routed pages now render inside one
// <main>, which also gives screen-reader users a jump-to-content target.
test("every route exposes exactly one main landmark", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
      `${route} never rendered`,
    ).toBeVisible({ timeout: 20_000 });

    const main = page.locator("main");
    await expect(main, `${route} has no single main landmark`).toHaveCount(1);
    await expect(main.first(), `${route}'s main landmark is hidden`).toBeVisible();
  }
});

// Lighthouse reported "`[user-scalable=\"no\"]` is used in the meta viewport
// element" (axe meta-viewport): the tag shipped maximum-scale=1.0 plus
// user-scalable=no, which stops a phone user from pinching to zoom the
// calculator text (WCAG 1.4.4). The prerendered HTML keeps the same tag on
// every route, so it is asserted on a marketing page and a calculator.
test("viewport tag lets a phone user pinch to zoom", async ({ page }) => {
  for (const route of ["/", "/ampacity"] as const) {
    await page.goto(route);
    const content = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(content, `${route} has no viewport meta tag`).toBeTruthy();
    expect(content, `${route} disables pinch-zoom`).not.toMatch(
      /user-scalable\s*=\s*(no|0)/i,
    );

    const maximumScale = /maximum-scale\s*=\s*([\d.]+)/i.exec(content ?? "");
    if (maximumScale) {
      expect(
        Number(maximumScale[1]),
        `${route} caps the zoom level`,
      ).toBeGreaterThanOrEqual(5);
    }
  }
});
