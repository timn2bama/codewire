import { defineConfig, devices } from "@playwright/test";

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
      "VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=stub-anon-key npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: "https://stub.supabase.co",
      VITE_SUPABASE_ANON_KEY: "stub-anon-key",
    },
  },
});
