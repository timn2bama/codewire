import { expect, test } from "@playwright/test";

// The bending calculator has four modes, each driven by a single dimension.
// A zero or blank dimension used to render a flat 0.00" result, which reads
// like a computed answer rather than a rejected input.
const MODES = [
  {
    label: "Offset",
    field: "Offset height",
    error: "Enter an offset height greater than zero.",
    status: "Enter a positive, finite offset height to calculate the bend.",
  },
  {
    label: "3-pt",
    field: "Obstruction depth",
    error: "Enter an obstruction depth greater than zero.",
    status:
      "Enter a positive, finite obstruction depth to calculate the bend.",
  },
  {
    label: "4-pt",
    field: "Obstruction depth",
    error: "Enter an obstruction depth greater than zero.",
    status:
      "Enter a positive, finite obstruction depth to calculate the bend.",
  },
  {
    label: "90°",
    field: "Desired stub height",
    error: "Enter a stub height greater than zero.",
    status: "Enter a positive, finite stub height to calculate the bend.",
  },
] as const;

test("invalid conduit-bending dimensions suppress the result and saving", async ({
  page,
}) => {
  await page.goto("/conduit-bending");
  const save = page.getByRole("button", { name: "Save", exact: true });

  for (const mode of MODES) {
    await page.getByRole("button", { name: mode.label, exact: true }).click();
    const field = page.getByLabel(mode.field).first();

    await field.fill("0");
    await expect(page.getByText(mode.error)).toBeVisible();
    await expect(page.getByText(mode.status)).toBeVisible();
    await expect(save).toHaveCount(0);

    await field.fill("");
    await expect(page.getByText(mode.error)).toBeVisible();
    await expect(page.getByText(mode.status)).toBeVisible();
    await expect(save).toHaveCount(0);

    // A positive dimension restores the result and the save affordance.
    await field.fill("6");
    await expect(page.getByText(mode.status)).toHaveCount(0);
    await expect(save).toBeVisible();
  }
});