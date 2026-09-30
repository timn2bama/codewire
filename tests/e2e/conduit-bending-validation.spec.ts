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

test("a 90° stub shorter than the take-up cannot produce a mark", async ({
  page,
}) => {
  await page.goto("/conduit-bending");
  await page.getByRole("button", { name: "90°", exact: true }).click();

  const stub = page.getByLabel("Desired stub height");
  const size = page.getByLabel("Conduit size (take-up)");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const markCard = page.getByText("Mark from end of conduit");

  // 1/2" EMT has a 5" take-up, so a 3" stub subtracts past the end of the
  // conduit and calcStub90 returns -2.00". The old build printed that negative
  // number as an ordinary result, alongside a "Save" button.
  await size.selectOption('1/2"');
  await stub.fill("3");
  await expect(
    page.getByText('A 3.00" stub is shorter than the 1/2" take-up of 5.00" — a bend this short cannot be made.'),
  ).toBeVisible();
  await expect(markCard).toHaveCount(0);
  await expect(save).toHaveCount(0);

  // The minimum bendable stub equals the take-up, so a 5" stub is still valid.
  await stub.fill("5");
  await expect(markCard).toBeVisible();
  await expect(page.getByText('0.00"').first()).toBeVisible();
  await expect(save).toBeVisible();

  // A larger conduit takes up more, so a stub that fitted 1/2" no longer does.
  await size.selectOption('2"');
  await expect(page.getByText(/cannot be made\./)).toBeVisible();
  await expect(markCard).toHaveCount(0);
  await expect(save).toHaveCount(0);

  // Back to a bendable stub: result and saving return.
  await stub.fill("20");
  await expect(markCard).toBeVisible();
  await expect(page.getByText('4.00"').first()).toBeVisible();
  await expect(save).toBeVisible();
});