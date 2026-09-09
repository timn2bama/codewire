import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, page }) => {
  await context.clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("discovers and opens every field calculator", async ({ page }) => {
  const calculators = [
    ["Voltage Drop", "/voltage-drop"],
    ["Conduit Fill", "/conduit-fill"],
    ["Wire Ampacity", "/ampacity"],
    ["Box Fill", "/box-fill"],
    ["Conduit Bending", "/conduit-bending"],
  ] as const;

  for (const [name, path] of calculators) {
    await page.goto("/");
    await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  }
});

test("preserves calculator input across a reload", async ({ page }) => {
  await page.goto("/ampacity");

  const load = page.getByLabel("Load (optional)");
  await load.fill("40");
  await expect(page.getByText("< 40 A", { exact: true })).toBeVisible();

  await page.reload();
  await expect(load).toHaveValue("40");
  await expect(page.getByText("< 40 A", { exact: true })).toBeVisible();
});

test("saves a calculation into a job and restores it from Saved Jobs", async ({
  page,
}) => {
  await page.goto("/ampacity");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Save calculation" }),
  ).toBeVisible();
  await page.getByLabel("Job / project name *").fill("Browser Smoke Job");
  await page.getByRole("button", { name: "Save to job" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Saved Jobs" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Browser Smoke Job/ })).toContainText(
    "1 saved",
  );
});
