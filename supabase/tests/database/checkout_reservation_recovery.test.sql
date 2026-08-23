begin;

select plan(26);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '41000000-0000-4000-8000-000000000001'::uuid,
    'checkout-takeover@example.test',
    '{}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000002'::uuid,
    'checkout-recovery@example.test',
    '{}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000003'::uuid,
    'checkout-retirement@example.test',
    '{}'::jsonb
  );

update public.profiles
set status = 'free',
    plan = null,
    stripe_customer_id = case id
      when '41000000-0000-4000-8000-000000000001'::uuid
        then 'cus_checkout_takeover'
      when '41000000-0000-4000-8000-000000000002'::uuid
        then 'cus_checkout_recovery'
      when '41000000-0000-4000-8000-000000000003'::uuid
        then 'cus_checkout_retirement'
    end
where id in (
  '41000000-0000-4000-8000-000000000001'::uuid,
  '41000000-0000-4000-8000-000000000002'::uuid,
  '41000000-0000-4000-8000-000000000003'::uuid
);

select is(
  (
    select pg_catalog.count(*)
    from public.profiles
    where id in (
      '41000000-0000-4000-8000-000000000001'::uuid,
      '41000000-0000-4000-8000-000000000002'::uuid,
      '41000000-0000-4000-8000-000000000003'::uuid
    )
      and status = 'free'
      and plan is null
      and stripe_customer_id is not null
  ),
  3::bigint,
  'auth trigger created all recovery test profiles'
);

select pg_catalog.set_config(
  'codewire.checkout_recovery_expiry_epoch',
  pg_catalog.floor(
    extract(
      epoch from pg_catalog.date_trunc(
        'second',
        pg_catalog.clock_timestamp()
      ) + interval '1 hour'
    )
  )::bigint::text,
  true
);

set local role service_role;

select is(
  (
    public.claim_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000001'::uuid,
      'cus_checkout_takeover',
      'monthly',
      'price_checkout_original',
      'https://codewire.test',
      7,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      ),
      '42000000-0000-4000-8000-000000000001'::uuid,
      '43000000-0000-4000-8000-000000000001'::uuid
    )->>'outcome'
  ),
  'create',
  'initial takeover fixture owns Checkout creation'
);

select is(
  (
    public.yield_stripe_checkout_reservation_lease(
      '41000000-0000-4000-8000-000000000001'::uuid,
      '42000000-0000-4000-8000-000000000001'::uuid,
      '43000000-0000-4000-8000-000000000001'::uuid
    )->>'outcome'
  ),
  'yielded',
  'the creation lease owner can yield its lease'
);

select is(
  (
    pg_catalog.set_config(
      'codewire.checkout_takeover_result',
      public.claim_stripe_checkout_reservation(
        '41000000-0000-4000-8000-000000000001'::uuid,
        'cus_checkout_takeover',
        'monthly',
        'price_checkout_must_not_replace_snapshot',
        'https://alternate.codewire.test',
        null,
        pg_catalog.to_timestamp(
          pg_catalog.current_setting(
            'codewire.checkout_recovery_expiry_epoch'
          )::double precision
        ),
        '42000000-0000-4000-8000-000000000002'::uuid,
        '43000000-0000-4000-8000-000000000002'::uuid
      )::text,
      true
    )::jsonb->>'outcome'
  ),
  'create',
  'a yielded creation lease can be taken over immediately'
);

select is(
  (
    pg_catalog.current_setting(
      'codewire.checkout_takeover_result'
    )::jsonb#>>'{snapshot,reservation_id}'
  ),
  '42000000-0000-4000-8000-000000000001',
  'lease takeover preserves the original reservation id'
);

select is(
  (
    pg_catalog.current_setting(
      'codewire.checkout_takeover_result'
    )::jsonb#>>'{snapshot,lease_token}'
  ),
  '43000000-0000-4000-8000-000000000002',
  'lease takeover installs the successor token'
);

select is(
  (
    pg_catalog.current_setting(
      'codewire.checkout_takeover_result'
    )::jsonb#>>'{snapshot,price_id}'
  ),
  'price_checkout_original',
  'lease takeover preserves the immutable request snapshot'
);

reset role;

update private.stripe_checkout_reservations
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second',
    updated_at = pg_catalog.clock_timestamp()
where profile_id = '41000000-0000-4000-8000-000000000001'::uuid;

set local role service_role;

select is(
  (
    public.claim_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000001'::uuid,
      'cus_checkout_takeover',
      'monthly',
      'price_checkout_still_must_not_replace_snapshot',
      'https://third.codewire.test',
      7,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      ),
      '42000000-0000-4000-8000-000000000009'::uuid,
      '43000000-0000-4000-8000-000000000009'::uuid
    )->>'outcome'
  ),
  'create',
  'an expired successor lease can be taken over'
);

select is(
  (
    public.publish_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000001'::uuid,
      '42000000-0000-4000-8000-000000000001'::uuid,
      '43000000-0000-4000-8000-000000000002'::uuid,
      'cs_checkout_takeover',
      'https://checkout.stripe.test/takeover',
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      )
    )->>'outcome'
  ),
  'stale',
  'the expired lease owner cannot publish after takeover'
);

select is(
  (
    public.yield_stripe_checkout_reservation_lease(
      '41000000-0000-4000-8000-000000000001'::uuid,
      '42000000-0000-4000-8000-000000000001'::uuid,
      '43000000-0000-4000-8000-000000000002'::uuid
    )->>'outcome'
  ),
  'stale',
  'the expired lease owner cannot yield after takeover'
);

select is(
  (
    public.publish_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000001'::uuid,
      '42000000-0000-4000-8000-000000000001'::uuid,
      '43000000-0000-4000-8000-000000000009'::uuid,
      'cs_checkout_takeover',
      'https://checkout.stripe.test/takeover',
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      )
    )->>'outcome'
  ),
  'stored',
  'the successor lease owner can publish the original reservation'
);

select is(
  (
    public.claim_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000002'::uuid,
      'cus_checkout_recovery',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      null,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      ),
      '42000000-0000-4000-8000-000000000003'::uuid,
      '43000000-0000-4000-8000-000000000003'::uuid
    )->>'outcome'
  ),
  'create',
  'initial unpublished recovery fixture owns Checkout creation'
);

reset role;

update private.stripe_checkout_reservations
set created_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '2 hours',
    requested_expires_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '1 hour',
    lease_expires_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '61 minutes',
    updated_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '1 hour'
where profile_id = '41000000-0000-4000-8000-000000000002'::uuid;

set local role service_role;

select is(
  (
    public.claim_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000002'::uuid,
      'cus_checkout_recovery',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      null,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      ),
      '42000000-0000-4000-8000-000000000004'::uuid,
      '43000000-0000-4000-8000-000000000004'::uuid
    )->>'reason'
  ),
  'checkout_recovery_required',
  'an expired unpublished request requires operator recovery'
);

reset role;

select is(
  (
    select state
    from private.stripe_checkout_reservations
    where profile_id = '41000000-0000-4000-8000-000000000002'::uuid
  ),
  'creating',
  'operator recovery preserves the unpublished request evidence'
);

set local role service_role;

select is(
  (
    public.claim_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000003'::uuid,
      'cus_checkout_retirement',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      7,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      ),
      '42000000-0000-4000-8000-000000000005'::uuid,
      '43000000-0000-4000-8000-000000000005'::uuid
    )->>'outcome'
  ),
  'create',
  'initial retirement fixture owns Checkout creation'
);

select is(
  (
    public.publish_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000003'::uuid,
      '42000000-0000-4000-8000-000000000005'::uuid,
      '43000000-0000-4000-8000-000000000005'::uuid,
      'cs_checkout_retirement',
      'https://checkout.stripe.test/retirement',
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_recovery_expiry_epoch'
        )::double precision
      )
    )->>'outcome'
  ),
  'stored',
  'retirement fixture publishes a ready session'
);

reset role;

update private.stripe_checkout_reservations
set created_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '2 hours',
    requested_expires_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '1 hour',
    lease_expires_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '61 minutes',
    updated_at = pg_catalog.date_trunc(
      'second',
      pg_catalog.clock_timestamp()
    ) - interval '1 hour'
where profile_id = '41000000-0000-4000-8000-000000000003'::uuid;

set local role service_role;

select is(
  (
    pg_catalog.set_config(
      'codewire.checkout_reconcile_result',
      public.claim_stripe_checkout_reservation(
        '41000000-0000-4000-8000-000000000003'::uuid,
        'cus_checkout_retirement',
        'monthly',
        'price_checkout_monthly_test',
        'https://codewire.test',
        7,
        pg_catalog.to_timestamp(
          pg_catalog.current_setting(
            'codewire.checkout_recovery_expiry_epoch'
          )::double precision
        ),
        '42000000-0000-4000-8000-000000000006'::uuid,
        '43000000-0000-4000-8000-000000000006'::uuid
      )::text,
      true
    )::jsonb->>'outcome'
  ),
  'reconcile',
  'an expired ready session enters reconciliation'
);

select is(
  (
    pg_catalog.current_setting(
      'codewire.checkout_reconcile_result'
    )::jsonb->>'session_id'
  ),
  'cs_checkout_retirement',
  'reconciliation preserves the Stripe session id'
);

select is(
  (
    public.retire_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000003'::uuid,
      '42000000-0000-4000-8000-000000000005'::uuid,
      '43000000-0000-4000-8000-000000000099'::uuid,
      'cs_checkout_retirement'
    )->>'outcome'
  ),
  'stale',
  'a non-owner cannot retire a reconciling session'
);

select is(
  (
    public.yield_stripe_checkout_reservation_lease(
      '41000000-0000-4000-8000-000000000003'::uuid,
      '42000000-0000-4000-8000-000000000005'::uuid,
      '43000000-0000-4000-8000-000000000006'::uuid
    )->>'outcome'
  ),
  'yielded',
  'the reconciliation owner can yield its lease'
);

select is(
  (
    pg_catalog.set_config(
      'codewire.checkout_reconcile_takeover_result',
      public.claim_stripe_checkout_reservation(
        '41000000-0000-4000-8000-000000000003'::uuid,
        'cus_checkout_retirement',
        'monthly',
        'price_checkout_monthly_test',
        'https://codewire.test',
        7,
        pg_catalog.to_timestamp(
          pg_catalog.current_setting(
            'codewire.checkout_recovery_expiry_epoch'
          )::double precision
        ),
        '42000000-0000-4000-8000-000000000007'::uuid,
        '43000000-0000-4000-8000-000000000007'::uuid
      )::text,
      true
    )::jsonb->>'outcome'
  ),
  'reconcile',
  'a yielded reconciliation lease can be taken over immediately'
);

select is(
  (
    pg_catalog.current_setting(
      'codewire.checkout_reconcile_takeover_result'
    )::jsonb->>'reservation_id'
  ),
  '42000000-0000-4000-8000-000000000005',
  'reconciliation takeover preserves the original reservation id'
);

select is(
  (
    public.retire_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000003'::uuid,
      '42000000-0000-4000-8000-000000000005'::uuid,
      '43000000-0000-4000-8000-000000000006'::uuid,
      'cs_checkout_retirement'
    )->>'outcome'
  ),
  'stale',
  'the former reconciliation owner cannot retire the session'
);

select is(
  (
    public.retire_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000003'::uuid,
      '42000000-0000-4000-8000-000000000005'::uuid,
      '43000000-0000-4000-8000-000000000007'::uuid,
      'cs_checkout_wrong'
    )->>'outcome'
  ),
  'stale',
  'the current reconciliation owner cannot retire a different session'
);

select is(
  (
    public.retire_stripe_checkout_reservation(
      '41000000-0000-4000-8000-000000000003'::uuid,
      '42000000-0000-4000-8000-000000000005'::uuid,
      '43000000-0000-4000-8000-000000000007'::uuid,
      'cs_checkout_retirement'
    )->>'outcome'
  ),
  'retired',
  'the current reconciliation owner can retire the verified session'
);

reset role;

select is(
  (
    select pg_catalog.count(*)
    from private.stripe_checkout_reservations
    where profile_id = '41000000-0000-4000-8000-000000000003'::uuid
  ),
  0::bigint,
  'retirement removes the checkout reservation'
);

select * from finish();

rollback;
