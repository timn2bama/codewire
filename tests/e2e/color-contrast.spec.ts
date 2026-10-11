import { expect, test } from "@playwright/test";

/**
 * WCAG 2.1 AA contrast for every public route.
 *
 * Lighthouse only samples three URLs, so a regression on /jobs, /login,
 * /upgrade, the guides or the legal pages was invisible - and its three-route
 * sample had already been failing at 0.84-0.88 for accessibility without that
 * ever being looked at. This walks every route and every visible text node, and
 * checks the two thresholds that actually apply: 4.5:1 for normal text, 3:1 for
 * large text (WCAG 1.4.3), skipping anything invisible or non-text.
 */

const ROUTES = [
  "/",
  "/about",
  "/jobs",
  "/login",
  "/upgrade",
  "/terms",
  "/privacy",
  "/voltage-drop-guide",
  "/conduit-fill-guide",
  "/codewire-vs-uglys",
  "/wire-size-chart",
  "/box-fill-guide",
  "/conduit-bending-guide",
  "/voltage-drop",
  "/conduit-fill",
  "/ampacity",
  "/box-fill",
  "/conduit-bending",
] as const;

interface ContrastFailure {
  route: string;
  selector: string;
  text: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  fontSize: string;
  fontWeight: string;
}

const SCAN = `(() => {
  const lum = (rgb) => {
    const f = (c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const parse = (value) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(value || "");
    if (!m) return null;
    const parts = m[1].split(",").map((p) => parseFloat(p));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const describe = (el) => {
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push("#" + el.id);
    const cls = (el.getAttribute("class") || "").split(/\\s+/).filter(Boolean).slice(0, 4);
    if (cls.length) parts.push("." + cls.join("."));
    return parts.join("");
  };
  // The background a text node is actually read against: the nearest ancestor
  // with an opaque background, composited down from there.
  const effectiveBg = (el) => {
    let node = el;
    while (node && node !== document.documentElement.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.alpha > 0.95) return bg.rgb;
      node = node.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return body ? body.rgb : [255, 255, 255];
  };

  const failures = [];
  const elements = document.querySelectorAll("body *");
  for (const el of elements) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (parseFloat(style.opacity) < 0.5) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (el.closest(".no-print")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    // Only leaf-ish text: avoid double-reporting a parent and its children.
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!ownText) continue;

    const fg = parse(style.color);
    if (!fg) continue;
    const size = parseFloat(style.fontSize);
    const weight = parseInt(style.fontWeight, 10) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;

    const bg = effectiveBg(el);
    const value = ratio(fg.rgb, bg);
    if (value + 0.005 < required) {
      failures.push({
        selector: describe(el),
        text: ownText.slice(0, 60),
        foreground: "rgb(" + fg.rgb.join(", ") + ")",
        background: "rgb(" + bg.join(", ") + ")",
        ratio: Math.round(value * 100) / 100,
        required,
        fontSize: style.fontSize,
        fontWeight: String(weight),
      });
    }
  }
  return failures;
})()`;

test("every route meets WCAG AA text contrast", async ({ page }) => {
  const failures: ContrastFailure[] = [];

  for (const route of ROUTES) {
    await page.goto(route);
    // Let the SPA hydrate and any lazy chunk land before measuring.
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
      `${route} never rendered`,
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(300);

    const found = (await page.evaluate(SCAN)) as Omit<ContrastFailure, "route">[];
    for (const f of found) failures.push({ route, ...f });
  }

  expect(failures.length, `contrast failures:\n${describeFailures(failures)}`).toBe(0);
});

// /jobs/:id and /jobs/:id/report are per-job URLs the fixed route list cannot
// reach, and the report is the one page rendered on a LIGHT surface (bg-white),
// where the muted grey scale has the opposite problem: slate-400 would fail
// there while it is the only accessible choice on the dark pages.
test("job detail and the printable report also meet WCAG AA contrast", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());

  await page.goto("/ampacity");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByLabel("Job / project name *").fill("Contrast Probe Job");
  await page.getByRole("button", { name: "Save to job" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

  await page.goto("/jobs");
  await page.getByRole("link", { name: /Contrast Probe Job/ }).click();
  const jobId = page.url().split("/").pop()!;

  const failures: ContrastFailure[] = [];
  const routes = [`/jobs/${jobId}`, `/jobs/${jobId}/report`];
  for (const route of routes) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
      `${route} never rendered`,
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(300);
    const found = (await page.evaluate(SCAN)) as Omit<ContrastFailure, "route">[];
    for (const f of found) failures.push({ route, ...f });
  }

  expect(failures.length, `contrast failures:\n${describeFailures(failures)}`).toBe(0);
});

function describeFailures(failures: ContrastFailure[]): string {
  return failures
    .map(
      (f) =>
        `${f.route} ${f.selector} [${f.text}]\n    ${f.foreground} on ${f.background}` +
        ` = ${f.ratio}:1 (needs ${f.required}:1, ${f.fontSize}, weight ${f.fontWeight})`,
    )
    .join("\n");
}