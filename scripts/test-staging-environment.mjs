import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  assertFreeProfile,
  assertProProfile,
  validateStagingEnvironment,
} from "./stagingEnvironment.mjs";

const config = validateStagingEnvironment(process.env);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const proClient = createClient(
  config.supabaseUrl,
  process.env.STAGING_SUPABASE_ANON_KEY,
  options,
);
const freeClient = createClient(
  config.supabaseUrl,
  process.env.STAGING_SUPABASE_ANON_KEY,
  options,
);
const adminClient = createClient(
  config.supabaseUrl,
  process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  options,
);

async function signIn(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`${label} staging sign-in failed: ${error?.message ?? "no user"}`);
  }
  return data.user;
}

async function ownProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("id,status,plan,current_period_end")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

const runId = `staging-smoke-${randomUUID()}`;
const calcId = `${runId}-calc`;
let proUser;

try {
  const [signedInPro, freeUser] = await Promise.all([
    signIn(
      proClient,
      process.env.STAGING_TEST_PRO_EMAIL,
      process.env.STAGING_TEST_PRO_PASSWORD,
      "Pro",
    ),
    signIn(
      freeClient,
      process.env.STAGING_TEST_FREE_EMAIL,
      process.env.STAGING_TEST_FREE_PASSWORD,
      "free",
    ),
  ]);
  proUser = signedInPro;

  const [proProfile, freeProfile] = await Promise.all([
    ownProfile(proClient, proUser.id),
    ownProfile(freeClient, freeUser.id),
  ]);
  assertProProfile(proProfile);
  assertFreeProfile(freeProfile);

  const timestamp = Date.now();
  const job = {
    id: runId,
    user_id: proUser.id,
    name: "Automated staging smoke test",
    job_number: null,
    phone: null,
    notes: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted: false,
  };
  const calculation = {
    id: calcId,
    user_id: proUser.id,
    job_id: runId,
    calculator_id: "voltage-drop",
    path: "/voltage-drop",
    title: "Staging smoke test",
    summary: "Disposable isolated staging data",
    result: "3.91%",
    state: {},
    created_at: timestamp,
    updated_at: timestamp,
    deleted: false,
  };

  const syncResult = await proClient.rpc("sync_codewire", {
    p_job_rows: [job],
    p_calc_rows: [calculation],
  });
  if (syncResult.error) throw syncResult.error;
  if (!syncResult.data?.jobs?.some((row) => row.id === runId)) {
    throw new Error("Pro sync did not return the staged job");
  }

  const crossAccountRead = await freeClient
    .from("jobs")
    .select("id")
    .eq("id", runId);
  if (crossAccountRead.error) throw crossAccountRead.error;
  if (crossAccountRead.data.length !== 0) {
    throw new Error("RLS exposed Pro account data to the free account");
  }

  const freeWrite = await freeClient.rpc("sync_codewire", {
    p_job_rows: [],
    p_calc_rows: [],
  });
  if (!freeWrite.error || freeWrite.error.code !== "42501") {
    throw new Error("The free account was not denied cloud sync");
  }

  const forgedWrite = await proClient.rpc("sync_codewire", {
    p_job_rows: [{ ...job, id: `${runId}-forged`, user_id: freeUser.id }],
    p_calc_rows: [],
  });
  if (forgedWrite.error) throw forgedWrite.error;
  const forgedRow = forgedWrite.data?.jobs?.find(
    (row) => row.id === `${runId}-forged`,
  );
  if (!forgedRow || forgedRow.user_id !== proUser.id) {
    throw new Error("Cloud sync trusted a client-supplied owner");
  }

  const forgedCrossAccountRead = await freeClient
    .from("jobs")
    .select("id")
    .eq("id", `${runId}-forged`);
  if (forgedCrossAccountRead.error) throw forgedCrossAccountRead.error;
  if (forgedCrossAccountRead.data.length !== 0) {
    throw new Error("RLS exposed the ownership-forgery probe to another account");
  }

  console.log("Staging auth, entitlement, RLS, and cloud-sync checks passed.");
  console.log("Stripe configuration is isolated in test mode; no charge was created.");
} finally {
  if (proUser) {
    const calcCleanup = await adminClient
      .from("saved_calcs")
      .delete()
      .eq("user_id", proUser.id)
      .eq("id", calcId);
    const jobCleanup = await adminClient
      .from("jobs")
      .delete()
      .eq("user_id", proUser.id)
      .in("id", [runId, `${runId}-forged`]);
    if (calcCleanup.error || jobCleanup.error) {
      console.error("Staging cleanup failed; remove rows with id prefix:", runId);
      process.exitCode = 1;
    }
  }
  await Promise.all([proClient.auth.signOut(), freeClient.auth.signOut()]);
}
