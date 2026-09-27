import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

interface RouteMetadataEntry {
  path: string;
  title: string;
  description: string;
}

const routeMetadata = JSON.parse(
  readFileSync(
    new URL("../../src/content/routeMetadata.json", import.meta.url),
    "utf8",
  ),
) as RouteMetadataEntry[];

// "/" and "/jobs" render without auth and are not described by routeMetadata.json.
const ROUTES = ["/", ...routeMetadata.map((entry) => entry.path), "/jobs"];

const CALCULATORS = [
  "/voltage-drop",
  "/conduit-fill",
  "/ampacity",
  "/box-fill",
  "/conduit-bending",
] as const;

// 24 px is the WCAG 2.2 "Target Size (Minimum)" guidance and the floor the
// daily audit measures against.
const TOUCH_TARGET_FLOOR = 24;

// A loaded CI runner needs more than the 5 s default for a route to mount.
const ROUTE_RENDER_TIMEOUT = 20_000;

// Known, unfixed shortfalls measured on 2026-09-27. Every entry is a real
// touch-target defect, not a tolerated one:
//   "/"                - seven footer links (Voltage drop, Conduit fill, Wire
//                        size chart, Box fill, Bending, vs Ugly's, contact
//                        address) render 14 px tall at phone width.
//   "/voltage-drop"    - "smallest wire that fits" recommendation chip, 20 px.
//   "/conduit-fill"    - "smallest conduit that fits" chip, 20 px.
//   "/ampacity"        - "smallest wire that fits" chip, 20 px.
//   "/box-fill"        - 20 x 20 "Internal cable clamps present" checkbox.
//   "/about"           - contact address link, 16 px tall (guide pages render
//                        the same link at a compliant size).
//   "/jobs"            - 1 x 1 hidden file input (not user-facing).
// These counts may only go DOWN. When the CSS is corrected, delete this map and
// replace the ratchet assertion below with `undersized` being empty.
const MAX_UNDERSIZED_CONTROLS: Record<string, number> = {
  "/": 7,
  "/jobs": 1,
  "/voltage-drop": 1,
  "/conduit-fill": 1,
  "/ampacity": 1,
  "/box-fill": 1,
  "/about": 1,
  "/conduit-bending": 0,
};

test.describe("mobile layout", () => {
  // These assertions are only meaningful in a phone-sized emulated browser.
  test.skip(({ isMobile }) => !isMobile, "mobile viewport coverage only");

  test("renders every route at phone width without horizontal overflow", async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
        `${route} never rendered a level-1 heading`,
      ).toBeVisible({ timeout: ROUTE_RENDER_TIMEOUT });

      const overflow = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const documentScrollWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        );

        const clips = (element: Element) => {
          let parent = element.parentElement;
          while (parent) {
            const style = window.getComputedStyle(parent);
            if (
              ["hidden", "clip", "auto", "scroll"].includes(
                style.overflowX,
              ) &&
              parent.clientWidth <= viewportWidth
            ) {
              return true;
            }
            parent = parent.parentElement;
          }
          return false;
        };

        const outsideViewport = Array.from(
          document.querySelectorAll<HTMLElement>("body *"),
        )
          .filter((element) => element.getClientRects().length > 0)
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 &&
              (rect.right > viewportWidth + 1 || rect.left < -1) &&
              !clips(element)
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return `${element.tagName.toLowerCase()}.${element.className || "(no class)"} right=${Math.round(rect.right)}`;
          })
          .slice(0, 5);

        return { viewportWidth, documentScrollWidth, outsideViewport };
      });

      expect(
        overflow.documentScrollWidth,
        `${route} scrolls horizontally at ${overflow.viewportWidth}px`,
      ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
      expect(
        overflow.outsideViewport,
        `${route} pushes content past the ${overflow.viewportWidth}px viewport`,
      ).toEqual([]);
    }
  });

  test("keeps calculator text inputs full-size at phone width", async ({
    page,
  }) => {
    for (const route of CALCULATORS) {
      await page.goto(route);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
        `${route} never rendered a level-1 heading`,
      ).toBeVisible({ timeout: ROUTE_RENDER_TIMEOUT });

      const tooSmall = await page.evaluate(
        (floor) =>
          Array.from(
            document.querySelectorAll<HTMLInputElement>(
              "input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea",
            ),
          )
            .filter((element) => element.getClientRects().length > 0)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                label:
                  element.getAttribute("aria-label") ??
                  element.name ??
                  element.id ??
                  "(unlabelled)",
                height: Math.round(rect.height),
                width: Math.round(rect.width),
              };
            })
            .filter((control) => control.width > 0 && control.height < floor),
        TOUCH_TARGET_FLOOR + 12,
      );

      expect(tooSmall, `${route} has under-sized inputs`).toEqual([]);
    }
  });

  test("does not add new under-sized touch targets", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
        `${route} never rendered a level-1 heading`,
      ).toBeVisible({ timeout: ROUTE_RENDER_TIMEOUT });

      const undersized = await page.evaluate((floor) =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            "input, select, textarea, button, a[href]",
          ),
        )
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label: (
                element.textContent ??
                element.getAttribute("aria-label") ??
                ""
              )
                .trim()
                .slice(0, 40),
              height: Math.round(rect.height),
              width: Math.round(rect.width),
            };
          })
          .filter(
            (control) =>
              control.width > 0 &&
              control.height > 0 &&
              (control.width < floor || control.height < floor),
          )
          .map((control) => `${control.label} (${control.width}x${control.height})`),
      TOUCH_TARGET_FLOOR);

      const allowed = MAX_UNDERSIZED_CONTROLS[route] ?? 0;
      expect(
        undersized.length,
        `${route} now has ${undersized.length} under-sized touch targets (limit ${allowed}): ${undersized
          .slice(0, 8)
          .join(", ")}`,
      ).toBeLessThanOrEqual(allowed);
    }
  });
});
