begin;

select plan(30);

select ok(
  pg_catalog.to_regclass('private.stripe_checkout_reservations') is not null,
  'checkout reservations table exists'
);

select ok(
  (
    select c.relrowsecurity
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname = 'stripe_checkout_reservations'
  ),
  'checkout reservations table has RLS enabled'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies
    where schemaname = 'private'
      and tablename = 'stripe_checkout_reservations'
  ),
  0::bigint,
  'checkout reservations table has no direct-access policies'
);

select ok(
  (
    select pg_catalog.count(*) = 0
    from (
      values ('anon'), ('authenticated'), ('service_role')
    ) as api_role(role_name)
    cross join (
      values
        ('SELECT'),
        ('INSERT'),
        ('UPDATE'),
        ('DELETE'),
        ('TRUNCATE'),
        ('REFERENCES'),
        ('TRIGGER'),
        ('MAINTAIN')
    ) as table_action(privilege_name)
    where pg_catalog.has_table_privilege(
      role_name::name,
      'private.stripe_checkout_reservations',
      privilege_name
    )
  )
  and (
    select pg_catalog.count(*) = 0
    from (
      values ('anon'), ('authenticated'), ('service_role')
    ) as api_role(role_name)
    cross join (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')
    ) as column_action(privilege_name)
    where pg_catalog.has_any_column_privilege(
      role_name::name,
      'private.stripe_checkout_reservations',
      privilege_name
    )
  ),
  'API roles have no direct checkout reservation table privileges'
);

select ok(
  pg_catalog.has_schema_privilege('service_role', 'private', 'USAGE'),
  'service role can resolve private objects used by the RPC owner'
);

select ok(
  not pg_catalog.has_schema_privilege('anon', 'private', 'USAGE'),
  'anonymous role cannot resolve private objects'
);

select is(
  (
    select pg_catalog.count(*)
    from (
      values
        (pg_catalog.to_regprocedure(
          'public.claim_stripe_checkout_reservation(uuid,text,text,text,text,integer,timestamptz,uuid,uuid)'
        )),
        (pg_catalog.to_regprocedure(
          'public.publish_stripe_checkout_reservation(uuid,uuid,uuid,text,text,timestamptz)'
        )),
        (pg_catalog.to_regprocedure(
          'public.retire_stripe_checkout_reservation(uuid,uuid,uuid,text)'
        )),
        (pg_catalog.to_regprocedure(
          'public.yield_stripe_checkout_reservation_lease(uuid,uuid,uuid)'
        ))
    ) as rpc(function_oid)
    where function_oid is not null
  ),
  4::bigint,
  'all checkout reservation RPCs exist with their expected signatures'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_stripe_checkout_reservation',
        'publish_stripe_checkout_reservation',
        'retire_stripe_checkout_reservation',
        'yield_stripe_checkout_reservation_lease'
      )
  ),
  4::bigint,
  'checkout reservation RPC names have no unexpected overloads'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_stripe_checkout_reservation',
        'publish_stripe_checkout_reservation',
        'retire_stripe_checkout_reservation',
        'yield_stripe_checkout_reservation_lease'
      )
      and p.prosecdef
  ),
  4::bigint,
  'all checkout reservation RPCs are security definer functions'
);

select is(
  (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_stripe_checkout_reservation',
        'publish_stripe_checkout_reservation',
        'retire_stripe_checkout_reservation',
        'yield_stripe_checkout_reservation_lease'
      )
      and 'search_path=""' = any(
        pg_catalog.coalesce(p.proconfig, '{}'::text[])
      )
  ),
  4::bigint,
  'all checkout reservation RPCs pin an empty search path'
);

select ok(
  (
    select pg_catalog.bool_and(
      pg_catalog.has_function_privilege(
        'service_role',
        function_oid,
        'EXECUTE'
      )
    )
    from (
      values
        (pg_catalog.to_regprocedure(
          'public.claim_stripe_checkout_reservation(uuid,text,text,text,text,integer,timestamptz,uuid,uuid)'
        )),
        (pg_catalog.to_regprocedure(
          'public.publish_stripe_checkout_reservation(uuid,uuid,uuid,text,text,timestamptz)'
        )),
        (pg_catalog.to_regprocedure(
          'public.retire_stripe_checkout_reservation(uuid,uuid,uuid,text)'
        )),
        (pg_catalog.to_regprocedure(
          'public.yield_stripe_checkout_reservation_lease(uuid,uuid,uuid)'
        ))
    ) as rpc(function_oid)
  ),
  'service role can execute every checkout reservation RPC'
);

select ok(
  not (
    select pg_catalog.bool_or(
      pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
    )
    from (
      values
        (pg_catalog.to_regprocedure(
          'public.claim_stripe_checkout_reservation(uuid,text,text,text,text,integer,timestamptz,uuid,uuid)'
        )),
        (pg_catalog.to_regprocedure(
          'public.publish_stripe_checkout_reservation(uuid,uuid,uuid,text,text,timestamptz)'
        )),
        (pg_catalog.to_regprocedure(
          'public.retire_stripe_checkout_reservation(uuid,uuid,uuid,text)'
        )),
        (pg_catalog.to_regprocedure(
          'public.yield_stripe_checkout_reservation_lease(uuid,uuid,uuid)'
        ))
    ) as rpc(function_oid)
  ),
  'anonymous role cannot execute checkout reservation RPCs'
);

select ok(
  not (
    select pg_catalog.bool_or(
      pg_catalog.has_function_privilege(
        'authenticated',
        function_oid,
        'EXECUTE'
      )
    )
    from (
      values
        (pg_catalog.to_regprocedure(
          'public.claim_stripe_checkout_reservation(uuid,text,text,text,text,integer,timestamptz,uuid,uuid)'
        )),
        (pg_catalog.to_regprocedure(
          'public.publish_stripe_checkout_reservation(uuid,uuid,uuid,text,text,timestamptz)'
        )),
        (pg_catalog.to_regprocedure(
          'public.retire_stripe_checkout_reservation(uuid,uuid,uuid,text)'
        )),
        (pg_catalog.to_regprocedure(
          'public.yield_stripe_checkout_reservation_lease(uuid,uuid,uuid)'
        ))
    ) as rpc(function_oid)
  ),
  'authenticated role cannot execute checkout reservation RPCs'
);

insert into auth.users (id, email)
values
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'checkout-reservation-one@example.test'
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    'checkout-reservation-two@example.test'
  );

update public.profiles
set stripe_customer_id = case id
  when '11111111-1111-4111-8111-111111111111'::uuid
    then 'cus_checkout_test_one'
  when '22222222-2222-4222-8222-222222222222'::uuid
    then 'cus_checkout_test_two'
end
where id in (
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid
);

select is(
  (
    select pg_catalog.count(*)
    from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'::uuid
      and stripe_customer_id = 'cus_checkout_test_one'
  ),
  1::bigint,
  'auth trigger created the first checkout profile fixture'
);

select is(
  (
    select pg_catalog.count(*)
    from public.profiles
    where id = '22222222-2222-4222-8222-222222222222'::uuid
      and stripe_customer_id = 'cus_checkout_test_two'
  ),
  1::bigint,
  'auth trigger created the second checkout profile fixture'
);

select pg_catalog.set_config(
  'codewire.checkout_test_expiry_epoch',
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
    pg_catalog.set_config(
      'codewire.checkout_create_result',
      public.claim_stripe_checkout_reservation(
        '11111111-1111-4111-8111-111111111111'::uuid,
        'cus_checkout_test_one',
        'monthly',
        'price_checkout_monthly_test',
        'https://codewire.test',
        7,
        pg_catalog.to_timestamp(
          pg_catalog.current_setting(
            'codewire.checkout_test_expiry_epoch'
          )::double precision
        ),
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      )::text,
      true
    )::jsonb->>'outcome'
  ),
  'create',
  'first claim owns Stripe Checkout creation'
);

select is(
  (
    pg_catalog.current_setting(
      'codewire.checkout_create_result'
    )::jsonb#>>'{snapshot,reservation_id}'
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'create outcome preserves the reservation id in its snapshot'
);

select is(
  (
    pg_catalog.current_setting(
      'codewire.checkout_create_result'
    )::jsonb#>>'{snapshot,lease_token}'
  ),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'create outcome preserves the lease token in its snapshot'
);

select is(
  (
    public.claim_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'cus_checkout_test_one',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      7,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      ),
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
    )->>'outcome'
  ),
  'wait',
  'a second same-account claim waits while the first lease is active'
);

select is(
  (
    public.claim_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'cus_checkout_test_one',
      'yearly',
      'price_checkout_yearly_test',
      'https://codewire.test',
      null,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
      'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
    )->>'reason'
  ),
  'checkout_plan_locked',
  'an active reservation prevents plan switching'
);

select is(
  (
    public.publish_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      'cs_test_checkout_one',
      'https://checkout.stripe.test/session-one',
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      )
    )->>'outcome'
  ),
  'stale',
  'a non-owner lease token cannot publish a Checkout session'
);

select is(
  (
    public.publish_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
      'cs_test_checkout_one',
      'https://checkout.stripe.test/session-one',
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      )
    )->>'outcome'
  ),
  'stored',
  'the lease owner can publish its Checkout session'
);

reset role;

select is(
  (
    select state
    from private.stripe_checkout_reservations
    where profile_id = '11111111-1111-4111-8111-111111111111'::uuid
  ),
  'ready',
  'publication persists the reservation in ready state'
);

set local role service_role;

select is(
  (
    public.publish_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
      'cs_test_checkout_one',
      'https://checkout.stripe.test/session-one',
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      )
    )->>'outcome'
  ),
  'already_stored',
  'an exact publish retry is idempotent'
);

select is(
  (
    public.claim_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'cus_checkout_test_one',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      7,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      ),
      '12121212-1212-4212-8212-121212121212'::uuid,
      '34343434-3434-4434-8434-343434343434'::uuid
    )->>'outcome'
  ),
  'reuse',
  'a ready same-plan Checkout session is reused'
);

select is(
  (
    public.claim_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'cus_checkout_test_one',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      7,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      ),
      '12121212-1212-4212-8212-121212121212'::uuid,
      '34343434-3434-4434-8434-343434343434'::uuid
    )->>'url'
  ),
  'https://checkout.stripe.test/session-one',
  'reuse returns the stored Stripe Checkout URL'
);

select is(
  (
    public.yield_stripe_checkout_reservation_lease(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    )->>'outcome'
  ),
  'stale',
  'a ready reservation lease cannot be yielded'
);

select is(
  (
    public.claim_stripe_checkout_reservation(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'cus_checkout_test_wrong',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      7,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      ),
      '56565656-5656-4656-8656-565656565656'::uuid,
      '78787878-7878-4878-8878-787878787878'::uuid
    )->>'reason'
  ),
  'customer_mismatch',
  'a mismatched Stripe customer cannot claim an account reservation'
);

reset role;

update public.profiles
set status = 'active', plan = 'monthly'
where id = '22222222-2222-4222-8222-222222222222'::uuid;

set local role service_role;

select is(
  (
    public.claim_stripe_checkout_reservation(
      '22222222-2222-4222-8222-222222222222'::uuid,
      'cus_checkout_test_two',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      null,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      ),
      '90909090-9090-4090-8090-909090909090'::uuid,
      'abababab-abab-4bab-8bab-abababababab'::uuid
    )->>'reason'
  ),
  'subscription_active',
  'an active subscription blocks Checkout creation'
);

select is(
  (
    public.claim_stripe_checkout_reservation(
      '99999999-9999-4999-8999-999999999999'::uuid,
      'cus_checkout_missing',
      'monthly',
      'price_checkout_monthly_test',
      'https://codewire.test',
      null,
      pg_catalog.to_timestamp(
        pg_catalog.current_setting(
          'codewire.checkout_test_expiry_epoch'
        )::double precision
      ),
      'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'::uuid,
      'efefefef-efef-4fef-8fef-efefefefefef'::uuid
    )->>'reason'
  ),
  'missing_profile',
  'a missing profile blocks Checkout creation'
);

reset role;

select * from finish();

rollback;
