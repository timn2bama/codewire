import { expect, test } from "@playwright/test";

test("a zero current-carrying count suppresses the ampacity result", async ({
  page,
}) => {
  await page.goto("/ampacity");

  const currentCarrying = page.getByLabel("# current-carrying");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const result = page.getByText("Usable ampacity");

  // 0 was silently coerced to 1 (the no-bundling-adjustment case), so the card
  // presented a real ampacity for a count that cannot occur in the field.
  await currentCarrying.fill("0");
  await expect(
    page.getByText("Enter a whole number of conductors (1 or more)."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Enter a whole number of current-carrying conductors (1 or more).",
    ),
  ).toBeVisible();
  await expect(result).toHaveCount(0);
  await expect(save).toHaveCount(0);

  await currentCarrying.fill("");
  await expect(result).toHaveCount(0);
  await expect(save).toHaveCount(0);

  // A real bundled count restores the result and the save affordance.
  await currentCarrying.fill("3");
  await expect(result).toBeVisible();
  await expect(save).toBeVisible();
});

test("a blank ambient temperature suppresses the ampacity result", async ({
  page,
}) => {
  await page.goto("/ampacity");

  const ambient = page.getByLabel("Ambient temp");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const result = page.getByText("Usable ampacity");

  await expect(result).toBeVisible();

  // Blank was read as 0 °C, the coldest 310.15(B)(1) row, whose correction
  // factor is above 1 — so the card reported a "Derated" figure larger than
  // the "Base" ampacity, which no derating table can produce.
  await ambient.fill("");
  await expect(
    page.getByText("Enter an ambient temperature in °C."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Enter an ambient temperature in °C (Table 310.15(B)(1) is based on 30 °C).",
    ),
  ).toBeVisible();
  await expect(page.getByText("Derated")).toHaveCount(0);
  await expect(result).toHaveCount(0);
  await expect(save).toHaveCount(0);

  // The factors footnote read the same blank as 0 °C — the coldest
  // 310.15(B)(1) row, whose factor is 1.15 — and printed "ambient 1.15" right
  // beside the message saying the temperature was missing. An incomplete
  // input must not display a correction factor either.
  await expect(page.getByText("Factors: ambient")).toHaveCount(0);

  // A real ambient temperature restores the result and the save affordance.
  await ambient.fill("30");
  await expect(result).toBeVisible();
  await expect(save).toBeVisible();
  await expect(page.getByText("Factors: ambient")).toBeVisible();
});