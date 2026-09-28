import { expect, test } from "@playwright/test";

test("invalid box-fill inputs suppress results, saving and the fill percentage", async ({
  page,
}) => {
  await page.goto("/box-fill");

  const boxVolume = page.getByLabel("Box volume");
  const qty = page.getByLabel("Qty").first();
  const save = page.getByRole("button", { name: "Save", exact: true });
  const incomplete = page.getByText(
    "Enter a box volume greater than zero and a positive whole-number quantity for every conductor.",
  );

  // A zero box volume used to render a result-shaped card reading "Fill: 0% /
  // Too small" for an input that cannot be evaluated.
  await boxVolume.fill("0");
  await expect(
    page.getByText("Enter a box volume greater than zero."),
  ).toBeVisible();
  await expect(incomplete).toBeVisible();
  await expect(save).toHaveCount(0);

  await boxVolume.fill("");
  await expect(
    page.getByText("Enter a box volume greater than zero."),
  ).toBeVisible();
  await expect(save).toHaveCount(0);

  // A zero conductor quantity is likewise incomplete, not a 0% fill.
  await boxVolume.fill("18");
  await qty.fill("0");
  await expect(
    page.getByText("Enter a whole-number quantity greater than zero."),
  ).toBeVisible();
  await expect(incomplete).toBeVisible();
  await expect(save).toHaveCount(0);

  // A whole-number quantity restores the result and the save affordance.
  await qty.fill("3");
  await expect(incomplete).toHaveCount(0);
  await expect(
    page.getByText("Enter a whole-number quantity greater than zero."),
  ).toHaveCount(0);
  await expect(save).toBeVisible();
});