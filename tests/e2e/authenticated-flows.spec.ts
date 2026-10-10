import { expect, test, type Page } from "@playwright/test";

/**
 * Coverage for the surfaces that the audit could never verify: the sign-in
 * redirect, the signed-in account shell, the entitlement the upgrade page
 * derives from it, the Stripe Checkout hand-off, and the PDF/print export.
 *
 * Two things made these unreachable before. The shipped build carries no
 * Supabase config in CI, so `useAuth().cloudEnabled` was false and the app
 * rendered "Accounts aren't set up in this build yet" instead of the form; and
 * there was no way to obtain a session without a real project and real users.
 *
 * playwright.config.ts therefore builds the e2e artifact with placeholder
 * VITE_SUPABASE_* values, and every cloud call is stubbed here. That exercises
 * the application's own wiring - form -> supabase-js -> session -> entitlement
 * -> checkout request - without credentials, secrets, or a live backend. The
 * real backend is still covered by `npm run test:staging` against staging.
 */

const CLOUD = "**://stub.supabase.co/**";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "stub-pro@example.com";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/stub-session";

function fakeUser() {
  const now = new Date().toISOString();
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: EMAIL,
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function fakeSession() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: "stub-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSeconds + 3600,
    refresh_token: "stub-refresh-token",
    user: fakeUser(),
  };
}

/** Answer every Supabase call a signed-in render can make. */
async function stubCloud(
  page: Page,
  profile: Record<string, unknown> = {
    id: USER_ID,
    status: "free",
    plan: "free",
    current_period_end: null,
  },
) {
  await page.route(CLOUD, async (route) => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (url.includes("/auth/v1/token")) return json(fakeSession());
    if (url.includes("/auth/v1/user")) return json(fakeUser());
    if (url.includes("/auth/v1/logout")) return route.fulfill({ status: 204, body: "" });
    if (url.includes("/rest/v1/profiles")) {
      // supabase-js sends Accept: application/vnd.pgrst.object+json for
      // `.single()` and then expects a bare object, not a one-element array.
      const wantsObject = (route.request().headers()["accept"] || "").includes(
        "pgrst.object",
      );
      return json(wantsObject ? profile : [profile]);
    }
    if (url.includes("/rest/v1/")) return json([]);
    return json({});
  });
}

// Entitlement is derived, not read: hasValidEntitlement() requires an
// active/trialing status, a plan of exactly "monthly" or "yearly", and a period
// end still in the future. A row claiming plan "pro" is NOT Pro - it renders the
// billing-recovery state, which is how the first version of this fixture failed.
const PRO_PROFILE = {
  id: USER_ID,
  status: "active",
  plan: "yearly",
  current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
};

/** Sign in through the real form against the stubbed cloud. */
async function signInViaForm(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("stub-password");
  // "Sign in" labels both the mode toggle and the submit button; the submit one
  // is last in the DOM.
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

/** Save a calculation into a job so a report exists to export. */
async function createJobWithCalculation(page: Page, name: string) {
  await page.goto("/ampacity");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Save calculation" })).toBeVisible();
  await page.getByLabel("Job / project name *").fill(name);
  await page.getByRole("button", { name: "Save to job" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("sends a signed-out visitor from /account to sign-in and keeps the return path", async ({
  page,
}) => {
  await page.goto("/account");

  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("signs in against a stubbed cloud and renders the signed-in account shell", async ({
  page,
}) => {
  await stubCloud(page);
  await signInViaForm(page);

  await expect(page.getByText(EMAIL)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  // The signed-out call to action must be gone once a session exists.
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});

test("a Pro profile unlocks the manage-plan state instead of checkout", async ({ page }) => {
  await stubCloud(page, PRO_PROFILE);
  await signInViaForm(page);

  await page.goto("/upgrade");

  // A Pro account gets the "you're on Pro" state with a route to manage it, and
  // never the checkout CTA a free account sees.
  await expect(page.getByText("You're on Pro")).toBeVisible();
  await expect(page.getByRole("link", { name: /Manage your plan/ })).toHaveAttribute(
    "href",
    "/account",
  );
  await expect(
    page.getByRole("button", { name: "Continue to secure checkout" }),
  ).toHaveCount(0);
});

test("starts Stripe Checkout for the chosen plan and follows the returned URL", async ({
  page,
}) => {
  await stubCloud(page);
  await signInViaForm(page);

  const checkoutRequest: { plan?: string; authorization?: string } = {};
  await page.route("**/api/create-checkout-session", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { plan?: string };
    checkoutRequest.plan = body?.plan;
    checkoutRequest.authorization = request.headers()["authorization"];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: CHECKOUT_URL }),
    });
  });
  // Keep the assertion on the request; the redirect target itself is stubbed so
  // the suite never depends on Stripe being reachable.
  await page.route(CHECKOUT_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stub Stripe Checkout</h1>" }),
  );

  await page.goto("/upgrade");
  await page.getByRole("button", { name: /Yearly/ }).click();
  await page.getByRole("button", { name: "Continue to secure checkout" }).click();

  await expect.poll(() => checkoutRequest?.plan).toBe("yearly");
  expect(checkoutRequest?.authorization).toBe("Bearer stub-access-token");
  await expect(page).toHaveURL(CHECKOUT_URL);
});

test("gates the report export behind Pro and points a free account at checkout", async ({
  page,
}) => {
  await stubCloud(page);
  await signInViaForm(page);
  await createJobWithCalculation(page, "Report Export Probe");

  await page.goto("/jobs");
  await page.getByRole("link", { name: /Report Export Probe/ }).click();

  const gate = page.getByRole("link", { name: /Export PDF/ });
  await expect(gate).toHaveText(/Pro/);
  await expect(gate).toHaveAttribute("href", "/upgrade");
});

test("exports a Pro job report through the print dialog", async ({ page }) => {
  await stubCloud(page, PRO_PROFILE);
  await signInViaForm(page);
  await createJobWithCalculation(page, "Report Export Probe");

  await page.goto("/jobs");
  await page.getByRole("link", { name: /Report Export Probe/ }).click();
  await page.getByRole("link", { name: "Export PDF report" }).click();

  await expect(page).toHaveURL(/\/jobs\/.+\/report$/);
  await expect(page.getByRole("heading", { name: "Codewire — Job Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Report Export Probe" })).toBeVisible();

  // The export is the browser's print pipeline, so the only thing worth
  // asserting is that the button reaches window.print() - headless Chromium can
  // never produce the PDF itself. The report's own contents are asserted above.
  await page.evaluate(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints += 1;
    };
  });
  await page.getByRole("button", { name: /Print \/ Save as PDF/ }).click();
  expect(
    await page.evaluate(() => (window as unknown as { __prints: number }).__prints),
  ).toBe(1);
});
