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

test("a derated ampacity is never rounded up past its own load badge", async ({
  page,
}) => {
  await page.goto("/ampacity");

  // 12 AWG Cu in the 90 °C column is 30 A (Table 310.16); a 50 °C ambient
  // applies the 310.15(B)(1) factor 0.82, giving 24.6 A. The headline used
  // toFixed(0) and so displayed "25 A" while `carriesLoad` compared the
  // unrounded 24.6 — the card read "USABLE AMPACITY 25 A" beside "< 25 A",
  // advertising an ampacity above the one it had actually computed.
  await page.getByLabel("Wire size").selectOption("12");
  await page.getByLabel("Insulation column").selectOption("90");
  await page.getByLabel("Ambient temp").fill("50");
  await page.getByLabel("# current-carrying").fill("3");
  await page.getByLabel("Termination rating").selectOption("90");
  await page.getByLabel("Load (optional)").fill("25");

  await expect(page.getByText("Derated")).toBeVisible();
  // The exact computed ampacity is shown (the Derated stat carries it too).
  await expect(page.getByText("24.6 A").first()).toBeVisible();
  // Not rounded up to the load it fails.
  await expect(page.getByText("25 A", { exact: true })).toHaveCount(0);
  await expect(page.getByText("< 25 A")).toBeVisible();

  // A whole-ampere ampacity still reads as a whole number in the headline
  // (two exact "30 A" nodes: the headline and the "Base" stat — a headline of
  // "30.0 A" would leave only one).
  await page.getByLabel("Ambient temp").fill("30");
  await expect(page.getByText("30 A", { exact: true })).toHaveCount(2);
  await expect(page.getByText("carries 25 A")).toBeVisible();
});
