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

// A load current large enough to drop the whole source voltage used to render a
// negative "at load" figure (-2617283830.6 V at 1e9 A) as if it were a computed
// answer. No conductor leaves a load below 0 V, so the card is withheld.
test("withholds the result when the drop exceeds the source voltage", async ({
  page,
}) => {
  await page.goto("/voltage-drop");

  const current = page.getByLabel("Load current");
  await current.fill("20000");

  await expect(
    page.getByText(
      "The voltage drop reaches the source voltage, so no voltage is left at the load. Check the load current, one-way length and wire size.",
    ),
  ).toBeVisible();
  await expect(page.getByText("At load:")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(page.getByText("> 3%", { exact: true })).toHaveCount(0);

  // 30 A keeps the same circuit inside the model: the card comes straight back.
  await current.fill("30");
  await expect(page.getByText("At load:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
