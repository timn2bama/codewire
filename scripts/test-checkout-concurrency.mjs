import assert from 'node:assert/strict'
import pg from 'pg'

const { Client } = pg

const LOCAL_DATABASE_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const parsedDatabaseUrl = new URL(LOCAL_DATABASE_URL)
const localHosts = new Set(['127.0.0.1', '[::1]'])
const databaseUser = decodeURIComponent(parsedDatabaseUrl.username)
const databasePassword = decodeURIComponent(parsedDatabaseUrl.password)

if (
  !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
  !localHosts.has(parsedDatabaseUrl.hostname) ||
  parsedDatabaseUrl.port !== '54322' ||
  parsedDatabaseUrl.pathname !== '/postgres' ||
  databaseUser !== 'postgres' ||
  parsedDatabaseUrl.search !== '' ||
  parsedDatabaseUrl.hash !== ''
) {
  throw new Error(
    'Checkout concurrency tests refuse non-local databases; expected postgres on loopback port 54322/postgres with no URL options.',
  )
}

const PROFILE_ONE = '31000000-0000-4000-8000-000000000001'
const PROFILE_TWO = '31000000-0000-4000-8000-000000000002'
const RESERVATION_ONE = '32000000-0000-4000-8000-000000000001'
const RESERVATION_TWO = '32000000-0000-4000-8000-000000000002'
const LEASE_ONE = '33000000-0000-4000-8000-000000000001'
const LEASE_TWO = '33000000-0000-4000-8000-000000000002'
const LEASE_THREE = '33000000-0000-4000-8000-000000000003'
const TEST_EMAILS = [
  'checkout-concurrency-one@example.test',
  'checkout-concurrency-two@example.test',
]

const checkoutRpcCalls = [
  {
    name: 'claim_stripe_checkout_reservation',
    sql: `select public.claim_stripe_checkout_reservation(
      $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::integer,
      $7::timestamptz, $8::uuid, $9::uuid
    ) as result`,
    values: [
      '39000000-0000-4000-8000-000000000009',
      'cus_checkout_denied',
      'monthly',
      'price_checkout_denied',
      'https://codewire.test',
      null,
      new Date(Math.floor(Date.now() / 1000) * 1000 + 60 * 60 * 1000),
      '39000000-0000-4000-8000-000000000010',
      '39000000-0000-4000-8000-000000000011',
    ],
  },
  {
    name: 'publish_stripe_checkout_reservation',
    sql: `select public.publish_stripe_checkout_reservation(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::timestamptz
    ) as result`,
    values: [
      '39000000-0000-4000-8000-000000000009',
      '39000000-0000-4000-8000-000000000010',
      '39000000-0000-4000-8000-000000000011',
      'cs_checkout_denied',
      'https://checkout.stripe.test/denied',
      new Date(Math.floor(Date.now() / 1000) * 1000 + 60 * 60 * 1000),
    ],
  },
  {
    name: 'retire_stripe_checkout_reservation',
    sql: `select public.retire_stripe_checkout_reservation(
      $1::uuid, $2::uuid, $3::uuid, $4::text
    ) as result`,
    values: [
      '39000000-0000-4000-8000-000000000009',
      '39000000-0000-4000-8000-000000000010',
      '39000000-0000-4000-8000-000000000011',
      'cs_checkout_denied',
    ],
  },
  {
    name: 'yield_stripe_checkout_reservation_lease',
    sql: `select public.yield_stripe_checkout_reservation_lease(
      $1::uuid, $2::uuid, $3::uuid
    ) as result`,
    values: [
      '39000000-0000-4000-8000-000000000009',
      '39000000-0000-4000-8000-000000000010',
      '39000000-0000-4000-8000-000000000011',
    ],
  },
]

function makeClient(applicationName) {
  return new Client({
    host:
      parsedDatabaseUrl.hostname === '[::1]'
        ? '::1'
        : parsedDatabaseUrl.hostname,
    port: Number(parsedDatabaseUrl.port),
    database: parsedDatabaseUrl.pathname.slice(1),
    user: databaseUser,
    password: databasePassword,
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
  })
}

function checkoutClaimValues({
  profileId,
  customerId,
  reservationId,
  leaseToken,
  expiresAt,
}) {
  return [
    profileId,
    customerId,
    'monthly',
    'price_checkout_monthly_test',
    'https://codewire.test',
    7,
    expiresAt,
    reservationId,
    leaseToken,
  ]
}

const claimSql = `select public.claim_stripe_checkout_reservation(
  $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::integer,
  $7::timestamptz, $8::uuid, $9::uuid
) as result`

async function beginAsServiceRole(client) {
  await client.query('begin')
  await client.query('set local role service_role')
}

async function rollbackQuietly(client) {
  try {
    await client.query('rollback')
  } catch {
    // Cleanup continues through the remaining clients and fixture deletion.
  }
}

async function expectRpcDenied(client, role, rpc) {
  assert.ok(
    role === 'anon' || role === 'authenticated',
    `Unexpected API role: ${role}`,
  )

  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    await client.query(rpc.sql, rpc.values)
    assert.fail(`${role} unexpectedly executed ${rpc.name}`)
  } catch (error) {
    assert.equal(
      error.code,
      '42501',
      `${role} must receive insufficient_privilege for ${rpc.name}`,
    )
  } finally {
    await rollbackQuietly(client)
  }
}

async function waitForBackendLock(admin, processId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const activity = await admin.query(
      `select wait_event_type
       from pg_catalog.pg_stat_activity
       where pid = $1`,
      [processId],
    )

    if (activity.rows[0]?.wait_event_type === 'Lock') {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return false
}

async function cleanupFixtures(admin) {
  await admin.query(
    `delete from auth.users
     where id = any($1::uuid[])
       or email = any($2::text[])`,
    [[PROFILE_ONE, PROFILE_TWO], TEST_EMAILS],
  )
}

async function run() {
  const admin = makeClient('codewire_checkout_test_admin')
  const first = makeClient('codewire_checkout_test_first')
  const second = makeClient('codewire_checkout_test_second')
  const connectedClients = []
  let blockedClaimPromise
  let cleanupAuthorized = false

  try {
    for (const client of [admin, first, second]) {
      await client.connect()
      connectedClients.push(client)
    }

    const identity = await admin.query(
      `select
         pg_catalog.current_database() as database_name,
         current_user as database_user,
         pg_catalog.current_setting('is_superuser') as is_superuser,
         pg_catalog.to_regclass(
           'private.stripe_checkout_reservations'
         )::text as reservation_table`,
    )
    assert.deepEqual(identity.rows[0], {
      database_name: 'postgres',
      database_user: 'postgres',
      is_superuser: 'on',
      reservation_table: 'private.stripe_checkout_reservations',
    })

    const migration = await admin.query(
      `select exists(
         select 1
         from supabase_migrations.schema_migrations
         where version = '20260815142908'
       ) as applied`,
    )
    assert.equal(migration.rows[0]?.applied, true)
    cleanupAuthorized = true

    await cleanupFixtures(admin)
    await admin.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values
         ($1::uuid, $3::text, '{}'::jsonb),
         ($2::uuid, $4::text, '{}'::jsonb)`,
      [PROFILE_ONE, PROFILE_TWO, ...TEST_EMAILS],
    )
    await admin.query(
      `update public.profiles
       set status = 'free',
           plan = null,
           stripe_customer_id = case id
             when $1::uuid then 'cus_checkout_concurrency_one'
             when $2::uuid then 'cus_checkout_concurrency_two'
           end
       where id = any($3::uuid[])`,
      [PROFILE_ONE, PROFILE_TWO, [PROFILE_ONE, PROFILE_TWO]],
    )

    for (const role of ['anon', 'authenticated']) {
      for (const rpc of checkoutRpcCalls) {
        await expectRpcDenied(first, role, rpc)
      }
    }

    const expiresAt = new Date(
      Math.floor(Date.now() / 1000) * 1000 + 60 * 60 * 1000,
    )
    const firstClaimValues = checkoutClaimValues({
      profileId: PROFILE_ONE,
      customerId: 'cus_checkout_concurrency_one',
      reservationId: RESERVATION_ONE,
      leaseToken: LEASE_ONE,
      expiresAt,
    })

    await beginAsServiceRole(first)
    const firstClaim = await first.query(claimSql, firstClaimValues)
    assert.equal(firstClaim.rows[0].result.outcome, 'create')

    await beginAsServiceRole(second)
    await second.query("set local statement_timeout = '10000ms'")
    let blockedClaimSettled = false
    blockedClaimPromise = second
      .query(
        claimSql,
        checkoutClaimValues({
          profileId: PROFILE_ONE,
          customerId: 'cus_checkout_concurrency_one',
          reservationId: RESERVATION_TWO,
          leaseToken: LEASE_TWO,
          expiresAt,
        }),
      )
      .then(
        (result) => {
          blockedClaimSettled = true
          return { result }
        },
        (error) => {
          blockedClaimSettled = true
          return { error }
        },
      )

    const observedLock = await waitForBackendLock(admin, second.processID)
    assert.equal(blockedClaimSettled, false, 'same-account claim must still wait')
    assert.equal(observedLock, true, 'same-account claim must wait on a DB lock')

    await first.query('commit')
    const blockedClaim = await blockedClaimPromise
    blockedClaimPromise = undefined
    assert.ifError(blockedClaim.error)
    assert.equal(blockedClaim.result.rows[0].result.outcome, 'wait')
    await second.query('commit')

    const storedReservation = await admin.query(
      `select reservation_id, state
       from private.stripe_checkout_reservations
       where profile_id = $1::uuid`,
      [PROFILE_ONE],
    )
    assert.deepEqual(storedReservation.rows[0], {
      reservation_id: RESERVATION_ONE,
      state: 'creating',
    })

    await beginAsServiceRole(first)
    const publication = await first.query(
      `select public.publish_stripe_checkout_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::timestamptz
      ) as result`,
      [
        PROFILE_ONE,
        RESERVATION_ONE,
        LEASE_ONE,
        'cs_checkout_concurrency_one',
        'https://checkout.stripe.test/concurrency-one',
        expiresAt,
      ],
    )
    assert.equal(publication.rows[0].result.outcome, 'stored')
    await first.query('commit')

    await beginAsServiceRole(first)
    const reusableClaim = await first.query(claimSql, firstClaimValues)
    assert.equal(reusableClaim.rows[0].result.outcome, 'reuse')

    await beginAsServiceRole(second)
    await second.query("set local lock_timeout = '1000ms'")
    await second.query("set local statement_timeout = '10000ms'")
    const unrelatedClaim = await second.query(
      claimSql,
      checkoutClaimValues({
        profileId: PROFILE_TWO,
        customerId: 'cus_checkout_concurrency_two',
        reservationId: RESERVATION_TWO,
        leaseToken: LEASE_THREE,
        expiresAt,
      }),
    )
    assert.equal(unrelatedClaim.rows[0].result.outcome, 'create')
    await second.query('rollback')
    await first.query('rollback')

    console.log(
      'Checkout DB gate passed: RPC ACLs, same-account serialization, and cross-account concurrency.',
    )
  } finally {
    await Promise.all(
      [first, second]
        .filter((client) => connectedClients.includes(client))
        .map((client) => rollbackQuietly(client)),
    )

    if (blockedClaimPromise) {
      await blockedClaimPromise
    }

    try {
      if (connectedClients.includes(admin) && cleanupAuthorized) {
        await cleanupFixtures(admin)
      }
    } finally {
      await Promise.allSettled(
        connectedClients.map((client) => client.end()),
      )
    }
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
