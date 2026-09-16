import { expect, test } from "@playwright/test";

test("invalid conduit quantities suppress compliance, sizing, and saving", async ({
  page,
}) => {
  await page.goto("/conduit-fill");

  const quantity = page.getByLabel("Qty");

  await quantity.fill("-3");
  await expect(
    page.getByText("Enter a whole-number quantity greater than zero."),
  ).toBeVisible();
  await expect(
    page.getByText("Enter a positive whole-number quantity for every conductor."),
  ).toBeVisible();
  await expect(page.getByText("valid quantities required")).toBeVisible();
  await expect(page.getByText("Within code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await quantity.fill("");
  await expect(
    page.getByText("Enter a whole-number quantity greater than zero."),
  ).toBeVisible();
  await expect(page.getByText("Within code")).toHaveCount(0);

  await quantity.fill("1.5");
  await expect(
    page.getByText("Enter a whole-number quantity greater than zero."),
  ).toBeVisible();
  await expect(page.getByText("Within code")).toHaveCount(0);

  await quantity.fill("3");
  await expect(
    page.getByText("Enter a positive whole-number quantity for every conductor."),
  ).toHaveCount(0);
  await expect(page.getByText("Within code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
