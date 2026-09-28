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