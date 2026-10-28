import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// This host keeps the Playwright browsers outside Chromium's default cache and
// outside the image-owned /opt/hermes tree (which is read-only, so `playwright
// install` fails there with EACCES). Every local run therefore needs
// PLAYWRIGHT_BROWSERS_PATH, and forgetting it produced "browserType.launch:
// Executable doesn't exist" - a launch failure that reads like a broken suite
// rather than a missing environment variable.
//
// Resolving it here means `npx playwright test` works with no wrapper and no
// exported variable. A configured path is honoured only when it actually holds a
// chrome binary: this host exports PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/tools, and
// that directory's chromium builds are empty, so a naive "used if set" rule still
// fails at launch. On a CI runner the local directory does not exist and the
// default install path is used, so CI behaviour is unchanged.
const LOCAL_BROWSERS = "/opt/data/.playwright";

/**
 * The revision this Playwright actually launches, read from its own manifest -
 * guessing from directory names is how `/opt/hermes/tools` (which holds only the
 * older chromium-1208 that lhci uses) looked usable while every e2e launch failed
 * with "Executable doesn't exist .../chromium_headless_shell-1248/...".
 */
function expectedHeadlessShellRevision(): string | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync("node_modules/playwright-core/browsers.json", "utf8"),
    ) as { browsers?: { name: string; revision: string }[] };
    const entry = manifest.browsers?.find(
      (b) => b.name === "chromium-headless-shell",
    );
    return entry ? String(entry.revision) : null;
  } catch {
    return null;
  }
}

const revision = expectedHeadlessShellRevision();
const hasRevision = (dir: string | undefined): boolean =>
  Boolean(dir && revision && fs.existsSync(`${dir}/chromium_headless_shell-${revision}`));

if (!hasRevision(process.env.PLAYWRIGHT_BROWSERS_PATH) && hasRevision(LOCAL_BROWSERS)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = LOCAL_BROWSERS;
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile viewport coverage. Pixel 7 runs on the same Chromium build the
      // desktop project already installs, so CI needs no extra browser download.
      // Without this project nothing in CI ever renders the app at phone width.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    // The authenticated surfaces only exist in a build that carries Supabase
    // config: with the env vars absent `cloudEnabled` is false and the app
    // renders "Accounts aren't set up in this build yet" instead of the sign-in
    // form, which is why sign-in, entitlement and Stripe went unverified. These
    // placeholders make the cloud UI render; tests/e2e/authenticated-flows.spec.ts
    // stubs every request they produce, so no real project or secret is needed.
    // Production builds are unaffected: they run `npm run build` directly.
    command:
      "VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=stub-anon-key VITE_E2E=1 npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: "https://stub.supabase.co",
      VITE_SUPABASE_ANON_KEY: "stub-anon-key",
      // Registers the /__error-probe route so the route error boundary can be
      // exercised against a real production build. Vite inlines this flag, so
      // the probe and its component are dead code in the deployed bundle.
      VITE_E2E: "1",
    },
  },
});
