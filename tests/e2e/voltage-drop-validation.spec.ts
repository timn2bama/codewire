import { expect, test } from "@playwright/test";

test("invalid voltage-drop inputs suppress results, sizing, and saving", async ({
  page,
}) => {
  await page.goto("/voltage-drop");

  const current = page.getByLabel("Load current");
  const voltage = page.getByLabel("Voltage");

  await current.fill("-30");
  await expect(page.getByText("Enter a current greater than zero.")).toBeVisible();
  await expect(
    page.getByText("Enter positive, finite values to calculate voltage drop."),
  ).toBeVisible();
  await expect(page.getByText("valid inputs required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(page.getByText("≤ 3%", { exact: true })).toHaveCount(0);

  await current.fill("30");
  await voltage.fill("0");
  await expect(page.getByText("Enter a voltage greater than zero.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await voltage.fill("");
  await expect(page.getByText("Enter a voltage greater than zero.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await voltage.fill("120");
  await expect(page.getByText("Enter positive, finite values to calculate voltage drop.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
