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

  // A blank or negative device count is incomplete too. It used to be read as
  // zero yokes, so a box that does not fit once the user's devices are counted
  // was reported as "Fits" for a field the user had not filled in.
  const devices = page.getByLabel("Devices (yokes)");
  const devicesError = page.getByText("Enter a number of devices (0 or more).", {
    exact: true,
  });

  await devices.fill("");
  await expect(devicesError).toBeVisible();
  await expect(incomplete).toBeVisible();
  await expect(save).toHaveCount(0);

  await devices.fill("-1");
  await expect(devicesError).toBeVisible();
  await expect(incomplete).toBeVisible();
  await expect(save).toHaveCount(0);

  // A count of zero is a real answer and keeps the result.
  await devices.fill("0");
  await expect(devicesError).toHaveCount(0);
  await expect(save).toBeVisible();
});