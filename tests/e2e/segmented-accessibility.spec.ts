import { expect, test } from "@playwright/test";

test("segmented controls expose selection and support native keyboard activation", async ({
  page,
}) => {
  await page.goto("/voltage-drop");

  const conductor = page.getByRole("group", { name: "Conductor" });
  const copper = conductor.getByRole("button", { name: "Copper" });
  const aluminum = conductor.getByRole("button", { name: "Aluminum" });

  await expect(copper).toHaveAttribute("aria-pressed", "true");
  await expect(aluminum).toHaveAttribute("aria-pressed", "false");
  await aluminum.focus();
  await page.keyboard.press("Space");
  await expect(aluminum).toBeFocused();
  await expect(aluminum).toHaveAttribute("aria-pressed", "true");
  await expect(copper).toHaveAttribute("aria-pressed", "false");

  await page.goto("/conduit-bending");

  const bendType = page.getByRole("group", { name: "Bend type" });
  const offset = bendType.getByRole("button", { name: "Offset" });
  const saddle = bendType.getByRole("button", { name: "3-pt" });

  await expect(offset).toHaveAttribute("aria-pressed", "true");
  await saddle.focus();
  await page.keyboard.press("Enter");
  await expect(saddle).toBeFocused();
  await expect(saddle).toHaveAttribute("aria-pressed", "true");
  await expect(offset).toHaveAttribute("aria-pressed", "false");
});
