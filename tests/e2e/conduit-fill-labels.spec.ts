import { expect, test } from "@playwright/test";

// The headline percentage belongs to the size currently selected, while "smallest
// ... that fits" is advice about a possibly different size. With a label that only
// said "Fill (40% allowed)", picking a larger conduit made the two read as a
// contradiction: 13.1% of a 1/2" conduit next to a 1/2" recommendation. The label
// now names its own size, and the advice says so when it matches.
test("the fill percentage names the selected size and the advice is separate", async ({
  page,
}) => {
  await page.goto("/conduit-fill");

  // Default state: three 12 AWG THHN conductors. 1/2" EMT is the smallest size
  // that fits, so it is also the selection and the advice must not look like a
  // second, conflicting result.
  await expect(page.getByText(/Fill in 1\/2" EMT/)).toBeVisible();
  await expect(page.getByText(/Smallest EMT that fits these conductors:/)).toBeVisible();
  await expect(page.getByText(/1\/2" \(already selected\)/)).toBeVisible();

  // Selecting a larger conduit moves the percentage but not the advice.
  await page.getByLabel("Trade size").selectOption('1"');
  await expect(page.getByText(/Fill in 1" EMT/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^1\/2" →$/ })).toBeVisible();
  await expect(page.getByText(/already selected/)).toHaveCount(0);

  // The reading is for the selected size: 1" EMT (0.864 in²) is a much smaller
  // percentage than 1/2" EMT (0.304 in²) for the same conductors.
  const percent = await page
    .locator("main")
    .getByText(/^\d+\.\d%$/)
    .first()
    .innerText();
  expect(Number.parseFloat(percent)).toBeLessThan(13.1);
});
