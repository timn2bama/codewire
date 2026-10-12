const PRODUCTION_PROJECT_REF = "lwqrkxslfputbnioatvn";
const PRODUCTION_HOSTS = new Set(["codewire.tools", "www.codewire.tools"]);

const REQUIRED_VARIABLES = [
  "STAGING_APP_URL",
  "STAGING_SUPABASE_URL",
  "STAGING_SUPABASE_ANON_KEY",
  "STAGING_SUPABASE_SERVICE_ROLE_KEY",
  "STAGING_TEST_PRO_EMAIL",
  "STAGING_TEST_PRO_PASSWORD",
  "STAGING_TEST_FREE_EMAIL",
  "STAGING_TEST_FREE_PASSWORD",
];

/**
 * Stripe test-mode values are optional, because this smoke test never calls
 * Stripe: it verifies auth, entitlement, RLS isolation and cloud sync against the
 * real staging backend. Requiring credentials for a check that does not run kept
 * the whole smoke test - the only way to exercise those paths for real - from
 * ever executing. Supply them and they are validated and reported like before;
 * leave them out and the run says so explicitly instead of implying Stripe was
 * checked.
 */
const STRIPE_VARIABLES = [
  "STAGING_STRIPE_SECRET_KEY",
  "STAGING_STRIPE_WEBHOOK_SECRET",
  "STAGING_STRIPE_PRICE_MONTHLY",
  "STAGING_STRIPE_PRICE_YEARLY",
];

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required staging variable: ${name}`);
  return value;
}

function httpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
  return url;
}

export function validateStagingEnvironment(env) {
  for (const name of REQUIRED_VARIABLES) required(env, name);

  const appUrl = httpsUrl(env.STAGING_APP_URL, "STAGING_APP_URL");
  const supabaseUrl = httpsUrl(
    env.STAGING_SUPABASE_URL,
    "STAGING_SUPABASE_URL",
  );

  if (PRODUCTION_HOSTS.has(appUrl.hostname.toLowerCase())) {
    throw new Error("Refusing to run staging tests against the production app");
  }
  if (
    supabaseUrl.hostname.toLowerCase().includes(PRODUCTION_PROJECT_REF) ||
    supabaseUrl.href.toLowerCase().includes(PRODUCTION_PROJECT_REF)
  ) {
    throw new Error(
      "Refusing to run staging tests against the production Supabase project",
    );
  }
  if (!supabaseUrl.hostname.endsWith(".supabase.co")) {
    throw new Error("STAGING_SUPABASE_URL must target a hosted Supabase project");
  }
  if (env.STAGING_TEST_PRO_EMAIL === env.STAGING_TEST_FREE_EMAIL) {
    throw new Error("The Pro and free staging accounts must be different users");
  }

  // A live key is never acceptable here, whether the rest are present or not.
  if ((env.STAGING_STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_live_")) {
    throw new Error("Refusing to run staging tests with a LIVE Stripe key");
  }

  const supplied = STRIPE_VARIABLES.filter((name) => env[name]?.trim());
  const stripeConfigured = supplied.length === STRIPE_VARIABLES.length;
  if (supplied.length > 0 && !stripeConfigured) {
    const missing = STRIPE_VARIABLES.filter((name) => !env[name]?.trim());
    throw new Error(
      `Incomplete Stripe test-mode configuration; missing ${missing.join(", ")}`,
    );
  }
  if (stripeConfigured) {
    if (!env.STAGING_STRIPE_SECRET_KEY.startsWith("sk_test_")) {
      throw new Error("STAGING_STRIPE_SECRET_KEY must be a Stripe test-mode key");
    }
    if (!env.STAGING_STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
      throw new Error("STAGING_STRIPE_WEBHOOK_SECRET must be a webhook secret");
    }
    for (const name of [
      "STAGING_STRIPE_PRICE_MONTHLY",
      "STAGING_STRIPE_PRICE_YEARLY",
    ]) {
      if (!env[name].startsWith("price_")) {
        throw new Error(`${name} must be a Stripe Price id`);
      }
    }
  }

  return {
    appUrl: appUrl.origin,
    supabaseUrl: supabaseUrl.origin,
    stripeConfigured,
  };
}

export function assertProProfile(profile) {
  if (!profile || !["active", "trialing"].includes(profile.status)) {
    throw new Error("The staging Pro account is not entitled");
  }
  if (!["monthly", "yearly"].includes(profile.plan)) {
    throw new Error("The staging Pro account has no recognized plan");
  }
  if (
    !profile.current_period_end ||
    Date.parse(profile.current_period_end) <= Date.now()
  ) {
    throw new Error("The staging Pro account entitlement is expired");
  }
}

export function assertFreeProfile(profile) {
  if (!profile || profile.status !== "free" || profile.plan !== null) {
    throw new Error("The staging free account unexpectedly has an entitlement");
  }
}
