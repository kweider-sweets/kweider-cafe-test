-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP EXTENSION pg_net;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM service_role;

CREATE SEQUENCE public.kweider_member_number_seq START WITH 1000;

GRANT ALL ON SEQUENCE public.kweider_member_number_seq TO service_role;

CREATE FUNCTION public.kweider_complete_pin_reset (
  p_reset_id       uuid,
  p_member_id      uuid,
  p_pin_hash       text,
  p_pin_salt       text,
  p_new_token_hash text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_access_token_id uuid;
  v_now timestamptz := now();
begin
  perform 1
  from public.kweider_pin_reset_requests
  where id = p_reset_id
    and member_id = p_member_id
    and status = 'approved'
    and used_at is null
    and expires_at > v_now
  for update;

  if not found then
    raise exception 'PIN_RESET_NOT_APPROVED';
  end if;

  insert into public.kweider_member_access_tokens (member_id, token_hash)
  values (p_member_id, p_new_token_hash)
  returning id into v_access_token_id;

  update public.kweider_members
  set access_pin_hash = p_pin_hash,
      access_pin_salt = p_pin_salt,
      access_pin_failed_attempts = 0,
      access_pin_locked_until = null,
      access_pin_updated_at = v_now
  where id = p_member_id;

  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  update public.kweider_member_access_tokens
  set revoked_at = v_now
  where member_id = p_member_id
    and id <> v_access_token_id
    and revoked_at is null;

  update public.kweider_pin_reset_requests
  set status = 'used', used_at = v_now
  where id = p_reset_id;

  update public.kweider_pin_reset_requests
  set status = 'cancelled'
  where member_id = p_member_id
    and id <> p_reset_id
    and status in ('pending', 'approved');

  return v_access_token_id;
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_complete_pin_reset(uuid, uuid, text, text, text) TO service_role;

CREATE FUNCTION public.kweider_issue_rewards_after_points_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.points_balance > old.points_balance then
    perform public.kweider_issue_rewards_and_messages(new.id);
  end if;

  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_issue_rewards_after_points_change() TO service_role;

CREATE FUNCTION public.kweider_issue_rewards_and_messages (
  p_member_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_points integer;
  v_cycle integer;
  v_cycle_points integer;
  v_cycle_size constant integer := 200;
  v_issued integer := 0;
begin
  select coalesce(points_balance, 0)
  into v_points
  from public.kweider_members
  where id = p_member_id
  for update;

  if not found then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  /*
    أمثلة:
    0 نقاط   = الدورة 1، التقدم 0
    200 نقطة = الدورة 1، التقدم 200
    201 نقطة = الدورة 2، التقدم 1
    400 نقطة = الدورة 2، التقدم 200
    460 نقطة = الدورة 3، التقدم 60
  */
  if v_points <= 0 then
    v_cycle := 1;
    v_cycle_points := 0;
  else
    v_cycle := ((v_points - 1) / v_cycle_size) + 1;
    v_cycle_points := ((v_points - 1) % v_cycle_size) + 1;
  end if;

  update public.kweider_members
  set reward_cycle = v_cycle
  where id = p_member_id;

  with cycle_status as (
    select
      generated_cycle as cycle_number,
      case
        when generated_cycle < v_cycle then v_cycle_size
        else v_cycle_points
      end as eligible_points
    from generate_series(1, v_cycle) as generated_cycle
  ),
  inserted_rewards as (
    insert into public.kweider_member_rewards (
      member_id,
      reward_code,
      cycle_number,
      status,
      issued_at,
      expires_at
    )
    select
      p_member_id,
      definition.code,
      cycle_status.cycle_number,
      'available',
      now(),
      now() + make_interval(days => definition.validity_days)
    from cycle_status
    cross join public.kweider_reward_definitions as definition
    where definition.active = true
      and definition.threshold_points <= cycle_status.eligible_points
    on conflict (member_id, reward_code, cycle_number)
      do nothing
    returning
      id,
      reward_code,
      cycle_number
  ),
  inserted_messages as (
    insert into public.kweider_member_messages (
      member_id,
      message_type,
      title_en,
      title_ar,
      body_en,
      body_ar,
      related_reward_id,
      dedupe_key,
      push_status,
      expires_at
    )
    select
      p_member_id,
      'reward_unlocked',
      'Reward unlocked!',
      'مكافأة جديدة!',
      definition.message_en
        || ' Valid for '
        || definition.validity_days
        || ' days.',
      definition.message_ar
        || ' صالحة لمدة '
        || definition.validity_days
        || ' يوماً.',
      inserted.id,
      'reward:'
        || p_member_id::text
        || ':'
        || inserted.reward_code
        || ':'
        || inserted.cycle_number::text,
      'pending',
      now() + make_interval(days => definition.validity_days)
    from inserted_rewards as inserted
    join public.kweider_reward_definitions as definition
      on definition.code = inserted.reward_code
    returning id
  )
  select count(*)
  into v_issued
  from inserted_rewards;

  return jsonb_build_object(
    'memberId', p_member_id,
    'points', v_points,
    'cycle', v_cycle,
    'cyclePoints', v_cycle_points,
    'cycleSize', v_cycle_size,
    'rewardsIssued', v_issued
  );
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_issue_rewards_and_messages(uuid) TO service_role;

CREATE FUNCTION public.kweider_make_member_code()
  RETURNS text
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
begin
  return
    'KW-' ||
    to_char(
      (now() at time zone 'Europe/London')::date,
      'YYMMDD'
    ) ||
    '-' ||
    lpad(
      nextval('public.kweider_member_number_seq')::text,
      6,
      '0'
    );
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_make_member_code() TO service_role;

CREATE FUNCTION public.kweider_normalize_phone (
  p_phone text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
declare
  v_raw text := btrim(p_phone);
  v_digits text := regexp_replace(p_phone, '[^0-9]', '', 'g');
  v_result text;
begin
  if v_digits = '' then
    raise exception 'Phone number is required';
  end if;

  if v_raw like '+%' then
    v_result := '+' || v_digits;

  elsif v_digits like '00%' then
    v_result := '+' || substr(v_digits, 3);

  elsif v_digits like '0%' and char_length(v_digits) = 11 then
    v_result := '+44' || substr(v_digits, 2);

  elsif v_digits like '44%' then
    v_result := '+' || v_digits;

  elsif v_digits like '7%' and char_length(v_digits) = 10 then
    v_result := '+44' || v_digits;

  else
    raise exception
      'Use 07 / +44 for UK numbers, or + / 00 for international numbers';
  end if;

  if char_length(regexp_replace(v_result, '[^0-9]', '', 'g'))
     not between 8 and 15 then
    raise exception 'Invalid phone number';
  end if;

  return v_result;
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_normalize_phone(text) TO service_role;

CREATE FUNCTION public.kweider_prepare_member()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
begin
  new.first_name := btrim(new.first_name);
  new.phone_e164 :=
    public.kweider_normalize_phone(new.phone_e164);

  new.email :=
    nullif(lower(btrim(coalesce(new.email, ''))), '');

  new.updated_at := now();

  return new;
end;
$function$;

CREATE FUNCTION public.kweider_queue_inactivity_reminders (
  p_now timestamp with time zone DEFAULT now()
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  inserted_count integer := 0;
begin

  insert into public.kweider_member_messages (
    member_id,
    message_type,
    title_en,
    title_ar,
    body_en,
    body_ar,
    related_reward_id,
    dedupe_key,
    is_read,
    read_at,
    push_status,
    push_sent_at,
    not_before,
    expires_at,
    created_at
  )
  select
    m.id,
    'inactivity',

    'Your Kweider points are waiting',
    'Your Kweider points are waiting',

    case
      when m.points_balance = 1 then
        'You still have 1 Kweider point waiting for you.'
      else
        format(
          'You still have %s Kweider points waiting for you.',
          m.points_balance
        )
    end,

    format(
      'لديك %s نقطة محفوظة في Kweider Rewards.',
      m.points_balance
    ),

    null,

    format(
      'inactivity:%s:%s',
      m.id,
      to_char(
        m.last_visit_at at time zone 'UTC',
        'YYYYMMDDHH24MISS'
      )
    ),

    false,
    null,
    'pending',
    null,
    p_now,
    p_now + interval '30 days',
    p_now

  from public.kweider_members m

  where m.status = 'active'
    and m.notification_consent = true
    and m.points_balance > 0
    and m.last_visit_at is not null
    and m.last_visit_at <= p_now - interval '21 days'

    -- لا نكرر تذكير عدم النشاط بعد الزيارة نفسها
    and not exists (
      select 1
      from public.kweider_member_messages previous
      where previous.member_id = m.id
        and previous.message_type = 'inactivity'
        and previous.created_at >= m.last_visit_at
    )

    -- حد أقصى رسالتان ذكيتان خلال 30 يوماً
    and (
      select count(*)
      from public.kweider_member_messages recent
      where recent.member_id = m.id
        and recent.created_at >= p_now - interval '30 days'
        and recent.message_type in (
          'near_reward',
          'reward_ready',
          'inactivity'
        )
    ) < 2

  on conflict (member_id, dedupe_key)
    where dedupe_key is not null
    do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_queue_inactivity_reminders(timestamp WITH time zone) TO service_role;

CREATE FUNCTION public.kweider_redeem_welcome_coffee (
  p_staff_user_id     uuid,
  p_member_id         uuid,
  p_purchase_amount   numeric,
  p_receipt_reference text    DEFAULT NULL::text,
  p_idempotency_key   text    DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_staff_name text;
  v_coffee public.kweider_welcome_coffees%rowtype;
begin
  if p_purchase_amount is null or p_purchase_amount <= 0 then
    raise exception 'PAID_ORDER_REQUIRED';
  end if;

  select display_name
    into v_staff_name
  from public.kweider_staff_profiles
  where user_id = p_staff_user_id
    and active = true
  limit 1;

  if v_staff_name is null then
    raise exception 'STAFF_NOT_AUTHORISED';
  end if;

  select *
    into v_coffee
  from public.kweider_welcome_coffees
  where member_id = p_member_id
  for update;

  if not found then
    raise exception 'WELCOME_COFFEE_NOT_FOUND';
  end if;

  if v_coffee.status = 'redeemed' then
    return jsonb_build_object(
      'ok', true,
      'alreadyRedeemed', true,
      'welcomeCoffeeId', v_coffee.id,
      'redeemedAt', v_coffee.redeemed_at
    );
  end if;

  if v_coffee.status <> 'available' then
    raise exception 'WELCOME_COFFEE_NOT_AVAILABLE';
  end if;

  if v_coffee.expires_at <= now() then
    update public.kweider_welcome_coffees
       set status = 'expired',
           updated_at = now()
     where id = v_coffee.id;

    raise exception 'WELCOME_COFFEE_EXPIRED';
  end if;

  update public.kweider_welcome_coffees
     set status = 'redeemed',
         redeemed_at = now(),
         redeemed_by_user_id = p_staff_user_id,
         redeemed_by_name = v_staff_name,
         purchase_amount = round(p_purchase_amount::numeric, 2),
         receipt_reference = nullif(trim(coalesce(p_receipt_reference, '')), ''),
         checkout_idempotency_key = nullif(trim(coalesce(p_idempotency_key, '')), ''),
         updated_at = now()
   where id = v_coffee.id
   returning * into v_coffee;

  return jsonb_build_object(
    'ok', true,
    'alreadyRedeemed', false,
    'welcomeCoffeeId', v_coffee.id,
    'status', v_coffee.status,
    'redeemedAt', v_coffee.redeemed_at,
    'redeemedByName', v_coffee.redeemed_by_name
  );
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_redeem_welcome_coffee(uuid, uuid, numeric, text, text) TO service_role;

CREATE FUNCTION public.kweider_set_last_visit_on_points_increase()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if new.points_balance > old.points_balance then
    new.last_visit_at := now();
  end if;

  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_set_last_visit_on_points_increase() TO service_role;

CREATE FUNCTION public.kweider_staff_add_purchase_points (
  p_staff_user_id     uuid,
  p_member_id         uuid,
  p_purchase_amount   numeric,
  p_receipt_reference text,
  p_idempotency_key   text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
declare
  v_staff_name text;
  v_staff_role text;

  v_member public.kweider_members%rowtype;
  v_transaction public.kweider_loyalty_transactions%rowtype;

  v_points_per_pound numeric;
  v_points_to_add integer;

  v_receipt text :=
    btrim(coalesce(p_receipt_reference, ''));

  v_idempotency_key text :=
    btrim(coalesce(p_idempotency_key, ''));
begin
  -- Validate the staff identity
  if p_staff_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'STAFF_USER_REQUIRED';
  end if;

  select
    display_name,
    staff_role
  into
    v_staff_name,
    v_staff_role
  from public.kweider_staff_profiles
  where user_id = p_staff_user_id
    and active = true;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'STAFF_NOT_AUTHORISED';
  end if;

  -- Validate the member
  if p_member_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'MEMBER_REQUIRED';
  end if;

  -- Validate purchase amount
  if p_purchase_amount is null
     or p_purchase_amount <= 0
     or p_purchase_amount > 100000 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PURCHASE_AMOUNT';
  end if;

  -- Receipt/reference is required
  if v_receipt = ''
     or char_length(v_receipt) > 100 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_RECEIPT_REFERENCE';
  end if;

  -- Prevent the same request being processed twice
  if v_idempotency_key = ''
     or char_length(v_idempotency_key) > 200 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- Lock the member row until this operation finishes
  select *
  into v_member
  from public.kweider_members
  where id = p_member_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'MEMBER_NOT_FOUND';
  end if;

  if v_member.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'MEMBERSHIP_NOT_ACTIVE';
  end if;

  -- Return the previous result if this request was already processed
  select *
  into v_transaction
  from public.kweider_loyalty_transactions
  where idempotency_key = v_idempotency_key;

  if found then
    if v_transaction.member_id <> p_member_id
       or v_transaction.transaction_type <> 'earn' then
      raise exception using
        errcode = 'P0001',
        message = 'IDEMPOTENCY_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'memberId', v_member.id,
      'memberCode', v_member.member_code,
      'firstName', v_member.first_name,
      'pointsAdded', v_transaction.points_delta,
      'currentPoints', v_member.points_balance,
      'transactionId', v_transaction.id,
      'receiptReference', v_transaction.receipt_reference,
      'performedBy', v_transaction.performed_by_name,
      'createdAt', v_transaction.created_at
    );
  end if;

  -- Read the loyalty programme settings
  select points_per_pound
  into v_points_per_pound
  from public.kweider_loyalty_settings
  where id = 1;

  if not found or v_points_per_pound <= 0 then
    raise exception using
      errcode = 'P0001',
      message = 'LOYALTY_SETTINGS_UNAVAILABLE';
  end if;

  -- Whole points only
  v_points_to_add :=
    floor(p_purchase_amount * v_points_per_pound)::integer;

  if v_points_to_add < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'PURCHASE_TOO_SMALL_FOR_POINTS';
  end if;

  -- Insert the transaction first
  insert into public.kweider_loyalty_transactions (
    member_id,
    transaction_type,
    points_delta,
    purchase_amount,
    reward_value,
    receipt_reference,
    performed_by,
    performed_by_name,
    notes,
    idempotency_key
  )
  values (
    p_member_id,
    'earn',
    v_points_to_add,
    p_purchase_amount,
    null,
    v_receipt,
    p_staff_user_id,
    v_staff_name,
    'Purchase points added by staff',
    v_idempotency_key
  )
  on conflict (idempotency_key)
  do nothing
  returning *
  into v_transaction;

  -- Handles two identical requests arriving at the same moment
  if not found then
    select *
    into v_transaction
    from public.kweider_loyalty_transactions
    where idempotency_key = v_idempotency_key;

    if not found
       or v_transaction.member_id <> p_member_id
       or v_transaction.transaction_type <> 'earn' then
      raise exception using
        errcode = 'P0001',
        message = 'IDEMPOTENCY_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'memberId', v_member.id,
      'memberCode', v_member.member_code,
      'firstName', v_member.first_name,
      'pointsAdded', v_transaction.points_delta,
      'currentPoints', v_member.points_balance,
      'transactionId', v_transaction.id,
      'receiptReference', v_transaction.receipt_reference,
      'performedBy', v_transaction.performed_by_name,
      'createdAt', v_transaction.created_at
    );
  end if;

  -- Update the points balance
  update public.kweider_members
  set points_balance =
    points_balance + v_points_to_add
  where id = p_member_id
  returning *
  into v_member;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'memberId', v_member.id,
    'memberCode', v_member.member_code,
    'firstName', v_member.first_name,
    'purchaseAmount', p_purchase_amount,
    'pointsAdded', v_points_to_add,
    'currentPoints', v_member.points_balance,
    'transactionId', v_transaction.id,
    'receiptReference', v_transaction.receipt_reference,
    'performedBy', v_staff_name,
    'staffRole', v_staff_role,
    'createdAt', v_transaction.created_at
  );
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_staff_add_purchase_points(uuid, uuid, numeric, text, text) TO service_role;

CREATE FUNCTION public.kweider_staff_complete_checkout (
  p_staff_user_id             uuid,
  p_member_id                 uuid,
  p_purchase_amount           numeric,
  p_idempotency_key           text,
  p_selected_member_reward_id uuid    DEFAULT NULL::uuid,
  p_breakfast_confirmed       boolean DEFAULT false,
  p_receipt_reference         text    DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_purchase_amount numeric(12,2);
  v_amount_paid numeric(12,2);
  v_discount_amount numeric(12,2) := 0;
  v_reward_value numeric(12,2) := 0;
  v_points_per_pound numeric;
  v_expected_points integer := 0;
  v_points_added integer := 0;
  v_new_balance integer := 0;
  v_receipt_reference text;
  v_fingerprint text;
  v_existing record;

  v_selected_found boolean := false;
  v_selected_kind text;
  v_selected_value numeric(12,2);
  v_selected_code text;
  v_selected_title_en text;
  v_selected_title_ar text;

  v_reward_id uuid;
  v_reward_code text;
  v_reward_kind text;
  v_reward_title_en text;
  v_reward_title_ar text;
  v_reward_expires_at timestamptz;

  v_fallback_applied boolean := false;
  v_reward_skipped_reason text := null;
  v_redeem_result jsonb := null;
  v_points_result jsonb := null;
  v_result jsonb;
begin
  if p_staff_user_id is null then
    raise exception 'STAFF_USER_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.kweider_staff_profiles
    where user_id = p_staff_user_id
      and active = true
  ) then
    raise exception 'STAFF_NOT_AUTHORISED';
  end if;

  if p_member_id is null then
    raise exception 'MEMBER_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.kweider_members
    where id = p_member_id
  ) then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.kweider_members
    where id = p_member_id
      and status = 'active'
  ) then
    raise exception 'MEMBERSHIP_NOT_ACTIVE';
  end if;

  if p_purchase_amount is null
     or p_purchase_amount < 0
     or p_purchase_amount > 100000 then
    raise exception 'INVALID_PURCHASE_AMOUNT';
  end if;

  v_purchase_amount := round(p_purchase_amount::numeric, 2);

  if p_idempotency_key is null
     or length(trim(p_idempotency_key)) < 8
     or length(trim(p_idempotency_key)) > 200 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  v_receipt_reference := nullif(trim(coalesce(p_receipt_reference, '')), '');

  if v_receipt_reference is null then
    -- Stable automatic reference: the same idempotency key always produces
    -- the same reference, which is safe when a request is retried.
    v_receipt_reference :=
      'AUTO-' || upper(substr(md5(trim(p_idempotency_key)), 1, 16));
  end if;

  if length(v_receipt_reference) > 100 then
    raise exception 'INVALID_RECEIPT_REFERENCE';
  end if;

  v_fingerprint := md5(
    p_member_id::text || '|' ||
    v_purchase_amount::text || '|' ||
    coalesce(p_selected_member_reward_id::text, '') || '|' ||
    coalesce(p_breakfast_confirmed, false)::text || '|' ||
    v_receipt_reference
  );

  -- Serialise retries using the checkout key.
  perform pg_advisory_xact_lock(hashtextextended(trim(p_idempotency_key), 0));

  select *
  into v_existing
  from public.kweider_checkout_operations
  where idempotency_key = trim(p_idempotency_key);

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'CHECKOUT_IDEMPOTENCY_CONFLICT';
    end if;

    return v_existing.result || jsonb_build_object('idempotent', true);
  end if;

  -- A reward is used only when the customer's QR contains a selected reward.
  if p_selected_member_reward_id is not null then
    select
      mr.id,
      mr.reward_code,
      d.reward_kind,
      d.maximum_discount,
      d.title_en,
      d.title_ar,
      mr.expires_at
    into
      v_reward_id,
      v_selected_code,
      v_selected_kind,
      v_selected_value,
      v_selected_title_en,
      v_selected_title_ar,
      v_reward_expires_at
    from public.kweider_member_rewards mr
    join public.kweider_reward_definitions d
      on d.code = mr.reward_code
     and d.active = true
    where mr.id = p_selected_member_reward_id
      and mr.member_id = p_member_id
      and mr.status = 'available'
      and (mr.expires_at is null or mr.expires_at > now())
    for update of mr;

    v_selected_found := found;

    if v_selected_found then
      if v_selected_kind = 'breakfast_for_two' then
        if not coalesce(p_breakfast_confirmed, false) then
          raise exception 'BREAKFAST_CONFIRMATION_REQUIRED';
        end if;

        v_reward_code := v_selected_code;
        v_reward_kind := v_selected_kind;
        v_reward_title_en := v_selected_title_en;
        v_reward_title_ar := v_selected_title_ar;

        -- The staff-entered figure is the amount actually payable after the
        -- free eligible breakfast has been removed from the till.
        v_amount_paid := v_purchase_amount;
        v_discount_amount := 0;
      else
        v_selected_value := round(coalesce(v_selected_value, 0), 2);

        if v_selected_value > 0
           and v_purchase_amount >= v_selected_value then
          v_reward_code := v_selected_code;
          v_reward_kind := v_selected_kind;
          v_reward_title_en := v_selected_title_en;
          v_reward_title_ar := v_selected_title_ar;
          v_reward_value := v_selected_value;
          v_discount_amount := v_selected_value;
          v_amount_paid := round(v_purchase_amount - v_discount_amount, 2);
        else
          -- Keep the selected reward unused and look for a smaller cash reward
          -- that can be used in full on this bill.
          v_reward_id := null;

          select
            mr.id,
            mr.reward_code,
            d.reward_kind,
            d.maximum_discount,
            d.title_en,
            d.title_ar,
            mr.expires_at
          into
            v_reward_id,
            v_reward_code,
            v_reward_kind,
            v_reward_value,
            v_reward_title_en,
            v_reward_title_ar,
            v_reward_expires_at
          from public.kweider_member_rewards mr
          join public.kweider_reward_definitions d
            on d.code = mr.reward_code
           and d.active = true
          where mr.member_id = p_member_id
            and mr.status = 'available'
            and (mr.expires_at is null or mr.expires_at > now())
            and d.reward_kind = 'percent_discount'
            and d.maximum_discount is not null
            and d.maximum_discount > 0
            and d.maximum_discount <= v_purchase_amount
          order by d.maximum_discount desc, mr.issued_at asc
          limit 1
          for update of mr;

          if found then
            v_fallback_applied := true;
            v_reward_value := round(coalesce(v_reward_value, 0), 2);
            v_discount_amount := v_reward_value;
            v_amount_paid := round(v_purchase_amount - v_discount_amount, 2);
          else
            v_reward_skipped_reason := 'bill_too_small';
            v_amount_paid := v_purchase_amount;
          end if;
        end if;
      end if;
    else
      -- A stale or already-used customer choice must never authorise a
      -- different reward. Keep every remaining reward available and add
      -- points only; the customer can refresh the card and choose again.
      v_reward_id := null;
      v_reward_skipped_reason := 'selected_reward_unavailable';
      v_amount_paid := v_purchase_amount;
    end if;
  else
    v_amount_paid := v_purchase_amount;
  end if;

  v_amount_paid := greatest(round(coalesce(v_amount_paid, 0), 2), 0);

  -- A zero payable amount is valid only for a confirmed Breakfast for Two.
  -- Cash rewards and points-only checkouts still require a positive bill.
  if v_purchase_amount = 0
     and not (
       v_reward_id is not null
       and v_reward_kind = 'breakfast_for_two'
       and coalesce(p_breakfast_confirmed, false)
     ) then
    raise exception 'INVALID_PURCHASE_AMOUNT';
  end if;

  -- Redeem first. If adding points later fails, PostgreSQL rolls back the whole
  -- function, so the reward can never be lost in a half-completed checkout.
  if v_reward_id is not null then
    select public.kweider_staff_redeem_member_reward(
      p_staff_user_id => p_staff_user_id,
      p_member_id => p_member_id,
      p_member_reward_id => v_reward_id,
      p_purchase_amount => case
        when v_reward_kind = 'breakfast_for_two' then null::numeric
        else v_purchase_amount
      end,
      p_receipt_reference => v_receipt_reference,
      p_idempotency_key => gen_random_uuid()::text
    )::jsonb
    into v_redeem_result;
  end if;

  select points_per_pound
  into v_points_per_pound
  from public.kweider_loyalty_settings
  where id = 1;

  if v_points_per_pound is null or v_points_per_pound <= 0 then
    raise exception 'LOYALTY_SETTINGS_UNAVAILABLE';
  end if;

  v_expected_points :=
    floor(v_amount_paid * v_points_per_pound)::integer;

  if v_expected_points > 0 then
    select public.kweider_staff_add_purchase_points(
      p_staff_user_id => p_staff_user_id,
      p_member_id => p_member_id,
      p_purchase_amount => v_amount_paid,
      p_receipt_reference => v_receipt_reference,
      p_idempotency_key => gen_random_uuid()::text
    )::jsonb
    into v_points_result;

    v_points_added := coalesce(
      nullif(v_points_result->>'pointsAdded', '')::integer,
      nullif(v_points_result->>'points_added', '')::integer,
      v_expected_points
    );
  end if;

  select points_balance
  into v_new_balance
  from public.kweider_members
  where id = p_member_id;

  v_result := jsonb_build_object(
    'checkoutCompleted', true,
    'billAmount', v_purchase_amount,
    'discountAmount', v_discount_amount,
    'amountPaid', v_amount_paid,
    'pointsAdded', v_points_added,
    'newPointsBalance', coalesce(v_new_balance, 0),
    'receiptReference', v_receipt_reference,
    'selectedMemberRewardId', p_selected_member_reward_id,
    'rewardUsed', v_reward_id is not null,
    'fallbackApplied', v_fallback_applied,
    'rewardSkippedReason', v_reward_skipped_reason,
    'breakfastConfirmed', coalesce(p_breakfast_confirmed, false),
    'reward', case
      when v_reward_id is null then null
      else jsonb_build_object(
        'memberRewardId', v_reward_id,
        'code', v_reward_code,
        'kind', v_reward_kind,
        'titleEn', v_reward_title_en,
        'titleAr', v_reward_title_ar,
        'value', case
          when v_reward_kind = 'breakfast_for_two' then null::numeric
          else v_discount_amount
        end,
        'expiresAt', v_reward_expires_at
      )
    end
  );

  insert into public.kweider_checkout_operations (
    idempotency_key,
    request_fingerprint,
    staff_user_id,
    member_id,
    selected_member_reward_id,
    purchase_amount,
    receipt_reference,
    breakfast_confirmed,
    result
  )
  values (
    trim(p_idempotency_key),
    v_fingerprint,
    p_staff_user_id,
    p_member_id,
    p_selected_member_reward_id,
    v_purchase_amount,
    v_receipt_reference,
    coalesce(p_breakfast_confirmed, false),
    v_result
  );

  return v_result;
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_staff_complete_checkout(uuid, uuid, numeric, text, uuid, boolean, text) TO service_role;

CREATE FUNCTION public.kweider_staff_redeem_member_reward (
  p_staff_user_id     uuid,
  p_member_id         uuid,
  p_member_reward_id  uuid,
  p_purchase_amount   numeric DEFAULT NULL::numeric,
  p_receipt_reference text    DEFAULT NULL::text,
  p_idempotency_key   text    DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_reward public.kweider_member_rewards%rowtype;
  v_definition public.kweider_reward_definitions%rowtype;

  v_staff_name text;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;

  v_purchase_amount numeric;
  v_reward_value numeric;
  v_receipt_reference text;
begin
  if p_staff_user_id is null then
    raise exception 'INVALID_STAFF_USER';
  end if;

  select display_name
  into v_staff_name
  from public.kweider_staff_profiles
  where user_id = p_staff_user_id
    and active = true;

  if not found then
    raise exception 'STAFF_NOT_AUTHORISED';
  end if;

  if p_member_id is null then
    raise exception 'INVALID_MEMBER_ID';
  end if;

  if p_member_reward_id is null then
    raise exception 'INVALID_MEMBER_REWARD_ID';
  end if;

  if length(trim(coalesce(p_idempotency_key, ''))) < 16 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  perform 1
  from public.kweider_members
  where id = p_member_id
    and status = 'active';

  if not found then
    raise exception 'MEMBER_NOT_AVAILABLE';
  end if;

  select *
  into v_reward
  from public.kweider_member_rewards
  where id = p_member_reward_id
    and member_id = p_member_id
  for update;

  if not found then
    raise exception 'REWARD_NOT_FOUND';
  end if;

  select *
  into v_definition
  from public.kweider_reward_definitions
  where code = v_reward.reward_code
    and active = true;

  if not found then
    raise exception 'REWARD_DEFINITION_UNAVAILABLE';
  end if;

  select id
  into v_existing_transaction_id
  from public.kweider_loyalty_transactions
  where idempotency_key = trim(p_idempotency_key);

  if found then
    if (
      v_reward.status = 'redeemed'
      and v_reward.redeemed_transaction_id = v_existing_transaction_id
    ) then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'transactionId', v_existing_transaction_id,
        'rewardId', v_reward.id,
        'rewardCode', v_reward.reward_code,
        'rewardKind', v_definition.reward_kind,
        'status', v_reward.status
      );
    end if;

    raise exception 'IDEMPOTENCY_KEY_CONFLICT';
  end if;

  if v_reward.status <> 'available' then
    raise exception 'REWARD_NOT_AVAILABLE';
  end if;

  if (
    v_reward.expires_at is not null
    and v_reward.expires_at <= now()
  ) then
    raise exception 'REWARD_EXPIRED';
  end if;

  v_purchase_amount :=
    case
      when p_purchase_amount is null then null
      else round(p_purchase_amount, 2)
    end;

  if v_definition.reward_kind = 'percent_discount' then
    if v_purchase_amount is null or v_purchase_amount <= 0 then
      raise exception 'INVALID_PURCHASE_AMOUNT';
    end if;

    v_reward_value :=
      round(
        v_purchase_amount
        * coalesce(v_definition.percent_off, 0)
        / 100,
        2
      );

    if v_definition.maximum_discount is not null then
      v_reward_value :=
        least(
          v_reward_value,
          v_definition.maximum_discount
        );
    end if;
  elsif v_definition.reward_kind = 'breakfast_for_two' then
    v_reward_value := 0;

    if v_purchase_amount is not null
       and v_purchase_amount <= 0 then
      v_purchase_amount := null;
    end if;
  else
    raise exception 'UNSUPPORTED_REWARD_KIND';
  end if;

  v_receipt_reference :=
    nullif(trim(coalesce(p_receipt_reference, '')), '');

  if v_receipt_reference is null then
    v_receipt_reference :=
      'KWR-'
      || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS')
      || '-'
      || upper(
        substr(
          replace(gen_random_uuid()::text, '-', ''),
          1,
          8
        )
      );
  end if;

  insert into public.kweider_loyalty_transactions (
    member_id,
    transaction_type,
    points_delta,
    purchase_amount,
    reward_value,
    receipt_reference,
    performed_by,
    performed_by_name,
    notes,
    idempotency_key
  )
  values (
    p_member_id,
    'redeem',
    0,
    v_purchase_amount,
    v_reward_value,
    v_receipt_reference,
    p_staff_user_id,
    v_staff_name,
    'Reward redeemed: '
      || v_reward.reward_code
      || ' · Member reward: '
      || v_reward.id::text,
    trim(p_idempotency_key)
  )
  returning id into v_transaction_id;

  update public.kweider_member_rewards
  set
    status = 'redeemed',
    redeemed_at = now(),
    redeemed_by = p_staff_user_id,
    redeemed_transaction_id = v_transaction_id,
    updated_at = now()
  where id = v_reward.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'transactionId', v_transaction_id,
    'rewardId', v_reward.id,
    'rewardCode', v_reward.reward_code,
    'rewardKind', v_definition.reward_kind,
    'rewardValue', v_reward_value,
    'purchaseAmount', v_purchase_amount,
    'receiptReference', v_receipt_reference,
    'pointsDelta', 0,
    'status', 'redeemed'
  );
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_staff_redeem_member_reward(uuid, uuid, uuid, numeric, text, text) TO service_role;

CREATE FUNCTION public.kweider_staff_redeem_rewards (
  p_staff_user_id     uuid,
  p_member_id         uuid,
  p_number_of_rewards integer,
  p_receipt_reference text,
  p_idempotency_key   text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO 'pg_catalog', 'public'
  AS $function$
declare
  v_staff_name text;
  v_staff_role text;

  v_member public.kweider_members%rowtype;
  v_transaction public.kweider_loyalty_transactions%rowtype;

  v_points_per_reward integer;
  v_reward_value numeric;
  v_points_to_redeem integer;
  v_total_reward_value numeric;

  v_receipt text :=
    btrim(coalesce(p_receipt_reference, ''));

  v_idempotency_key text :=
    btrim(coalesce(p_idempotency_key, ''));
begin
  -- Confirm that the employee exists and is active
  if p_staff_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'STAFF_USER_REQUIRED';
  end if;

  select
    display_name,
    staff_role
  into
    v_staff_name,
    v_staff_role
  from public.kweider_staff_profiles
  where user_id = p_staff_user_id
    and active = true;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'STAFF_NOT_AUTHORISED';
  end if;

  -- Validate the membership
  if p_member_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'MEMBER_REQUIRED';
  end if;

  -- Validate the number of rewards
  if p_number_of_rewards is null
     or p_number_of_rewards < 1
     or p_number_of_rewards > 100 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_REWARD_QUANTITY';
  end if;

  -- Receipt/reference is required
  if v_receipt = ''
     or char_length(v_receipt) > 100 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_RECEIPT_REFERENCE';
  end if;

  -- Prevent the same request being processed twice
  if v_idempotency_key = ''
     or char_length(v_idempotency_key) > 200 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- Lock the membership until the operation finishes
  select *
  into v_member
  from public.kweider_members
  where id = p_member_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'MEMBER_NOT_FOUND';
  end if;

  if v_member.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'MEMBERSHIP_NOT_ACTIVE';
  end if;

  -- Return the previous result if already processed
  select *
  into v_transaction
  from public.kweider_loyalty_transactions
  where idempotency_key = v_idempotency_key;

  if found then
    if v_transaction.member_id <> p_member_id
       or v_transaction.transaction_type <> 'redeem' then
      raise exception using
        errcode = 'P0001',
        message = 'IDEMPOTENCY_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'memberId', v_member.id,
      'memberCode', v_member.member_code,
      'firstName', v_member.first_name,
      'pointsRedeemed', abs(v_transaction.points_delta),
      'rewardValue', v_transaction.reward_value,
      'currentPoints', v_member.points_balance,
      'transactionId', v_transaction.id,
      'receiptReference', v_transaction.receipt_reference,
      'performedBy', v_transaction.performed_by_name,
      'createdAt', v_transaction.created_at
    );
  end if;

  -- Read programme settings
  select
    points_per_reward,
    reward_value
  into
    v_points_per_reward,
    v_reward_value
  from public.kweider_loyalty_settings
  where id = 1;

  if not found
     or v_points_per_reward <= 0
     or v_reward_value <= 0 then
    raise exception using
      errcode = 'P0001',
      message = 'LOYALTY_SETTINGS_UNAVAILABLE';
  end if;

  v_points_to_redeem :=
    p_number_of_rewards * v_points_per_reward;

  v_total_reward_value :=
    p_number_of_rewards * v_reward_value;

  if v_member.points_balance < v_points_to_redeem then
    raise exception using
      errcode = 'P0001',
      message = 'INSUFFICIENT_POINTS';
  end if;

  -- Record the redemption
  insert into public.kweider_loyalty_transactions (
    member_id,
    transaction_type,
    points_delta,
    purchase_amount,
    reward_value,
    receipt_reference,
    performed_by,
    performed_by_name,
    notes,
    idempotency_key
  )
  values (
    p_member_id,
    'redeem',
    -v_points_to_redeem,
    null,
    v_total_reward_value,
    v_receipt,
    p_staff_user_id,
    v_staff_name,
    p_number_of_rewards::text || ' reward(s) redeemed',
    v_idempotency_key
  )
  on conflict (idempotency_key)
  do nothing
  returning *
  into v_transaction;

  -- Handle two identical requests arriving together
  if not found then
    select *
    into v_transaction
    from public.kweider_loyalty_transactions
    where idempotency_key = v_idempotency_key;

    if not found
       or v_transaction.member_id <> p_member_id
       or v_transaction.transaction_type <> 'redeem' then
      raise exception using
        errcode = 'P0001',
        message = 'IDEMPOTENCY_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'memberId', v_member.id,
      'memberCode', v_member.member_code,
      'firstName', v_member.first_name,
      'pointsRedeemed', abs(v_transaction.points_delta),
      'rewardValue', v_transaction.reward_value,
      'currentPoints', v_member.points_balance,
      'transactionId', v_transaction.id,
      'receiptReference', v_transaction.receipt_reference,
      'performedBy', v_transaction.performed_by_name,
      'createdAt', v_transaction.created_at
    );
  end if;

  -- Deduct the points
  update public.kweider_members
  set points_balance =
    points_balance - v_points_to_redeem
  where id = p_member_id
    and points_balance >= v_points_to_redeem
  returning *
  into v_member;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'INSUFFICIENT_POINTS';
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'memberId', v_member.id,
    'memberCode', v_member.member_code,
    'firstName', v_member.first_name,
    'numberOfRewards', p_number_of_rewards,
    'pointsRedeemed', v_points_to_redeem,
    'rewardValue', v_total_reward_value,
    'currentPoints', v_member.points_balance,
    'availableRewards',
      floor(
        v_member.points_balance::numeric /
        v_points_per_reward
      )::integer,
    'transactionId', v_transaction.id,
    'receiptReference', v_transaction.receipt_reference,
    'performedBy', v_staff_name,
    'staffRole', v_staff_role,
    'createdAt', v_transaction.created_at
  );
end;
$function$;

GRANT ALL ON FUNCTION public.kweider_staff_redeem_rewards(uuid, uuid, integer, text, text) TO service_role;

CREATE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE TABLE public.kweider_checkout_operations (
  id                        uuid                     DEFAULT gen_random_uuid() NOT NULL,
  idempotency_key           text                     NOT NULL,
  request_fingerprint       text                     NOT NULL,
  staff_user_id             uuid                     NOT NULL,
  member_id                 uuid                     NOT NULL,
  selected_member_reward_id uuid,
  purchase_amount           numeric(12,2)            NOT NULL,
  receipt_reference         text                     NOT NULL,
  breakfast_confirmed       boolean                  DEFAULT false NOT NULL,
  result                    jsonb                    NOT NULL,
  created_at                timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.kweider_checkout_operations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_checkout_operations
  ADD CONSTRAINT kweider_checkout_operations_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE public.kweider_checkout_operations
  ADD CONSTRAINT kweider_checkout_operations_pkey PRIMARY KEY (id);

GRANT ALL ON public.kweider_checkout_operations TO service_role;

CREATE INDEX kweider_checkout_operations_member_created_idx ON public.kweider_checkout_operations (member_id, created_at DESC);

CREATE TABLE public.kweider_loyalty_settings (
  id                smallint                 DEFAULT 1 NOT NULL,
  points_per_pound  numeric(10,2)            DEFAULT 1 NOT NULL,
  points_per_reward integer                  DEFAULT 100 NOT NULL,
  reward_value      numeric(10,2)            DEFAULT 5 NOT NULL,
  updated_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.kweider_loyalty_settings
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_loyalty_settings
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_loyalty_settings
  ADD CONSTRAINT kweider_loyalty_settings_id_check CHECK (id = 1);

ALTER TABLE public.kweider_loyalty_settings
  ADD CONSTRAINT kweider_loyalty_settings_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_loyalty_settings
  ADD CONSTRAINT kweider_loyalty_settings_points_per_pound_check CHECK (points_per_pound > 0::numeric);

ALTER TABLE public.kweider_loyalty_settings
  ADD CONSTRAINT kweider_loyalty_settings_points_per_reward_check CHECK (points_per_reward > 0);

ALTER TABLE public.kweider_loyalty_settings
  ADD CONSTRAINT kweider_loyalty_settings_reward_value_check CHECK (reward_value > 0::numeric);

GRANT ALL ON public.kweider_loyalty_settings TO service_role;

CREATE TABLE public.kweider_loyalty_transactions (
  id                uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_id         uuid                     NOT NULL,
  transaction_type  text                     NOT NULL,
  points_delta      integer                  NOT NULL,
  purchase_amount   numeric(10,2),
  reward_value      numeric(10,2),
  receipt_reference text,
  performed_by      uuid,
  performed_by_name text,
  notes             text,
  idempotency_key   text,
  created_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.kweider_loyalty_transactions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_loyalty_transactions
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_check
    CHECK
    (transaction_type = 'welcome'::text AND points_delta = 0 OR transaction_type = 'earn'::text AND points_delta > 0 OR transaction_type = 'redeem'::text AND points_delta <= 0 OR
    (transaction_type = ANY (ARRAY['adjustment'::text, 'migration'::text])));

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_purchase_amount_check CHECK (purchase_amount IS NULL OR purchase_amount >= 0::numeric);

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_reward_value_check CHECK (reward_value IS NULL OR reward_value >= 0::numeric);

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_transaction_type_check
    CHECK (transaction_type = ANY (ARRAY['welcome'::text, 'earn'::text, 'redeem'::text, 'adjustment'::text, 'migration'::text]));

GRANT ALL ON public.kweider_loyalty_transactions TO service_role;

CREATE INDEX kweider_transactions_member_date_idx ON public.kweider_loyalty_transactions (member_id, created_at DESC);

CREATE UNIQUE INDEX kweider_loyalty_unique_earn_receipt ON public.kweider_loyalty_transactions (lower(btrim(receipt_reference)))
  WHERE transaction_type = 'earn'::text AND NULLIF(btrim(receipt_reference), ''::text) IS NOT NULL;

CREATE TABLE public.kweider_member_access_tokens (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_id    uuid                     NOT NULL,
  token_hash   text                     NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at   timestamp with time zone
);

ALTER TABLE public.kweider_member_access_tokens
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_member_access_tokens
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_member_access_tokens
  ADD CONSTRAINT kweider_member_access_tokens_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_member_access_tokens
  ADD CONSTRAINT kweider_member_access_tokens_token_hash_key UNIQUE (token_hash);

GRANT ALL ON public.kweider_member_access_tokens TO service_role;

CREATE INDEX kweider_member_access_tokens_member_idx ON public.kweider_member_access_tokens (member_id);

CREATE TABLE public.kweider_member_messages (
  id                uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_id         uuid                     NOT NULL,
  message_type      text                     NOT NULL,
  title_en          text                     NOT NULL,
  title_ar          text                     NOT NULL,
  body_en           text                     NOT NULL,
  body_ar           text                     NOT NULL,
  related_reward_id uuid,
  dedupe_key        text,
  is_read           boolean                  DEFAULT false NOT NULL,
  read_at           timestamp with time zone,
  push_status       text                     DEFAULT 'pending'::text NOT NULL,
  push_sent_at      timestamp with time zone,
  not_before        timestamp with time zone DEFAULT now() NOT NULL,
  expires_at        timestamp with time zone,
  created_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.kweider_member_messages
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_member_messages
  ADD CONSTRAINT kweider_member_messages_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE public.kweider_member_messages
  ADD CONSTRAINT kweider_member_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_member_messages
  ADD CONSTRAINT kweider_member_messages_push_status_check CHECK (push_status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]));

GRANT ALL ON public.kweider_member_messages TO service_role;

CREATE INDEX kweider_member_messages_inbox_idx ON public.kweider_member_messages (member_id, is_read, created_at DESC);

CREATE UNIQUE INDEX kweider_member_messages_dedupe_uidx ON public.kweider_member_messages (member_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX kweider_member_messages_member_created_idx ON public.kweider_member_messages (member_id, created_at DESC);

CREATE INDEX kweider_member_messages_delivery_idx ON public.kweider_member_messages (push_status, not_before, expires_at);

CREATE TABLE public.kweider_member_rewards (
  id                        uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_id                 uuid                     NOT NULL,
  reward_code               text                     NOT NULL,
  cycle_number              integer                  NOT NULL,
  status                    text                     DEFAULT 'available'::text NOT NULL,
  issued_at                 timestamp with time zone DEFAULT now() NOT NULL,
  expires_at                timestamp with time zone NOT NULL,
  redeemed_at               timestamp with time zone,
  redeemed_by_user          uuid,
  redemption_transaction_id uuid,
  redemption_note           text,
  created_at                timestamp with time zone DEFAULT now() NOT NULL,
  updated_at                timestamp with time zone DEFAULT now() NOT NULL,
  redeemed_by               uuid,
  redeemed_transaction_id   uuid
);

ALTER TABLE public.kweider_member_rewards
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_member_rewards
  ADD CONSTRAINT kweider_member_rewards_cycle_number_check CHECK (cycle_number > 0);

ALTER TABLE public.kweider_member_rewards
  ADD CONSTRAINT kweider_member_rewards_member_id_reward_code_cycle_number_key UNIQUE (member_id, reward_code, cycle_number);

ALTER TABLE public.kweider_member_rewards
  ADD CONSTRAINT kweider_member_rewards_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_member_messages
  ADD CONSTRAINT kweider_member_messages_related_reward_id_fkey FOREIGN KEY (related_reward_id) REFERENCES public.kweider_member_rewards(id) ON DELETE SET NULL;

ALTER TABLE public.kweider_member_rewards
  ADD CONSTRAINT kweider_member_rewards_redemption_transaction_id_fkey FOREIGN KEY (redemption_transaction_id) REFERENCES public.kweider_loyalty_transactions(id) ON DELETE SET NULL;

ALTER TABLE public.kweider_member_rewards
  ADD CONSTRAINT kweider_member_rewards_status_check CHECK (status = ANY (ARRAY['available'::text, 'redeemed'::text, 'expired'::text, 'cancelled'::text]));

GRANT ALL ON public.kweider_member_rewards TO service_role;

CREATE INDEX kweider_member_rewards_member_status_idx ON public.kweider_member_rewards (member_id, status, expires_at);

CREATE TABLE public.kweider_members (
  id                                 uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_code                        text                     DEFAULT public.kweider_make_member_code() NOT NULL,
  first_name                         text                     NOT NULL,
  phone_e164                         text                     NOT NULL,
  email                              text,
  birthday                           date,
  marketing_consent                  boolean                  DEFAULT false NOT NULL,
  points_balance                     integer                  DEFAULT 0 NOT NULL,
  status                             text                     DEFAULT 'active'::text NOT NULL,
  created_at                         timestamp with time zone DEFAULT now() NOT NULL,
  updated_at                         timestamp with time zone DEFAULT now() NOT NULL,
  reward_cycle                       integer                  DEFAULT 1 NOT NULL,
  last_visit_at                      timestamp with time zone,
  notification_consent               boolean                  DEFAULT false NOT NULL,
  notification_consent_at            timestamp with time zone,
  access_pin_hash                    text,
  access_pin_salt                    text,
  access_pin_failed_attempts         integer                  DEFAULT 0 NOT NULL,
  access_pin_locked_until            timestamp with time zone,
  access_pin_updated_at              timestamp with time zone,
  notification_consent_revoked_at    timestamp with time zone,
  notification_preference_updated_at timestamp with time zone
);

COMMENT ON COLUMN public.kweider_members.notification_consent IS 'Consent for Kweider app reward notifications only. Not WhatsApp, SMS or email.';

COMMENT ON COLUMN public.kweider_members.access_pin_hash IS 'HMAC-SHA256 digest of the customer 4-digit access PIN. Never exposed to clients.';

COMMENT ON COLUMN public.kweider_members.access_pin_salt IS 'Random per-member salt used when deriving the access PIN digest.';

COMMENT ON COLUMN public.kweider_members.access_pin_failed_attempts IS 'Consecutive failed PIN attempts. Five failures temporarily lock PIN access.';

COMMENT ON COLUMN public.kweider_members.access_pin_locked_until IS 'PIN access lock expiry after repeated incorrect attempts.';

COMMENT ON COLUMN public.kweider_members.access_pin_updated_at IS 'Timestamp of the most recent PIN creation or reset.';

ALTER TABLE public.kweider_members
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_members
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_members
  ADD CONSTRAINT kweider_members_birthday_check CHECK (birthday IS NULL OR birthday <= CURRENT_DATE);

ALTER TABLE public.kweider_members
  ADD CONSTRAINT kweider_members_first_name_check CHECK (char_length(btrim(first_name)) >= 1 AND char_length(btrim(first_name)) <= 50);

ALTER TABLE public.kweider_members
  ADD CONSTRAINT kweider_members_member_code_key UNIQUE (member_code);

ALTER TABLE public.kweider_members
  ADD CONSTRAINT kweider_members_phone_e164_key UNIQUE (phone_e164);

ALTER TABLE public.kweider_members
  ADD CONSTRAINT kweider_members_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_checkout_operations
  ADD CONSTRAINT kweider_checkout_operations_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE CASCADE;

ALTER TABLE public.kweider_loyalty_transactions
  ADD CONSTRAINT kweider_loyalty_transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE RESTRICT;

ALTER TABLE public.kweider_member_access_tokens
  ADD CONSTRAINT kweider_member_access_tokens_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE CASCADE;

ALTER TABLE public.kweider_member_messages
  ADD CONSTRAINT kweider_member_messages_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE CASCADE;

ALTER TABLE public.kweider_member_rewards
  ADD CONSTRAINT kweider_member_rewards_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE CASCADE;

ALTER TABLE public.kweider_members
  ADD CONSTRAINT kweider_members_points_balance_check CHECK (points_balance >= 0);

ALTER TABLE public.kweider_members
  ADD CONSTRAINT kweider_members_status_check CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text]));

GRANT ALL ON public.kweider_members TO service_role;

CREATE TRIGGER kweider_members_issue_rewards
  AFTER UPDATE OF points_balance ON public.kweider_members
  FOR EACH ROW
  WHEN (new.points_balance > old.points_balance)
  EXECUTE FUNCTION public.kweider_issue_rewards_after_points_change();

CREATE TRIGGER kweider_members_set_last_visit
  BEFORE UPDATE OF points_balance ON public.kweider_members
  FOR EACH ROW
  WHEN (new.points_balance > old.points_balance)
  EXECUTE FUNCTION public.kweider_set_last_visit_on_points_increase();

CREATE TRIGGER kweider_prepare_member_trigger
  BEFORE INSERT OR UPDATE ON public.kweider_members
  FOR EACH ROW
  EXECUTE FUNCTION public.kweider_prepare_member();

CREATE TABLE public.kweider_pin_reset_requests (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_id    uuid                     NOT NULL,
  token_hash   text                     NOT NULL,
  status       text                     DEFAULT 'pending'::text NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at   timestamp with time zone NOT NULL,
  approved_at  timestamp with time zone,
  approved_by  uuid,
  used_at      timestamp with time zone
);

ALTER TABLE public.kweider_pin_reset_requests
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_pin_reset_requests
  ADD CONSTRAINT kweider_pin_reset_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE CASCADE;

ALTER TABLE public.kweider_pin_reset_requests
  ADD CONSTRAINT kweider_pin_reset_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_pin_reset_requests
  ADD CONSTRAINT kweider_pin_reset_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'used'::text, 'cancelled'::text, 'expired'::text]));

ALTER TABLE public.kweider_pin_reset_requests
  ADD CONSTRAINT kweider_pin_reset_requests_token_hash_key UNIQUE (token_hash);

GRANT ALL ON public.kweider_pin_reset_requests TO service_role;

CREATE INDEX kweider_pin_reset_member_status_idx ON public.kweider_pin_reset_requests (member_id, status, requested_at DESC);

CREATE TABLE public.kweider_push_subscriptions (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_id       uuid                     NOT NULL,
  endpoint        text                     NOT NULL,
  p256dh_key      text                     NOT NULL,
  auth_secret     text                     NOT NULL,
  user_agent      text,
  device_label    text,
  active          boolean                  DEFAULT true NOT NULL,
  last_success_at timestamp with time zone,
  last_failure_at timestamp with time zone,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  updated_at      timestamp with time zone DEFAULT now() NOT NULL,
  consent_at      timestamp with time zone,
  revoked_at      timestamp with time zone,
  last_seen_at    timestamp with time zone,
  failure_count   integer                  DEFAULT 0 NOT NULL,
  disabled_reason text
);

ALTER TABLE public.kweider_push_subscriptions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_push_subscriptions
  ADD CONSTRAINT kweider_push_subscriptions_endpoint_key UNIQUE (endpoint);

ALTER TABLE public.kweider_push_subscriptions
  ADD CONSTRAINT kweider_push_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE CASCADE;

ALTER TABLE public.kweider_push_subscriptions
  ADD CONSTRAINT kweider_push_subscriptions_pkey PRIMARY KEY (id);

GRANT ALL ON public.kweider_push_subscriptions TO service_role;

CREATE INDEX kweider_push_subscriptions_member_idx ON public.kweider_push_subscriptions (member_id, active);

CREATE UNIQUE INDEX kweider_push_subscriptions_endpoint_uidx ON public.kweider_push_subscriptions (endpoint);

CREATE INDEX kweider_push_subscriptions_member_active_idx ON public.kweider_push_subscriptions (member_id, active)
  WHERE active = true;

CREATE TABLE public.kweider_reward_definitions (
  code             text                     NOT NULL,
  threshold_points integer                  NOT NULL,
  reward_kind      text                     NOT NULL,
  title_en         text                     NOT NULL,
  title_ar         text                     NOT NULL,
  message_en       text                     NOT NULL,
  message_ar       text                     NOT NULL,
  percent_off      numeric(5,2),
  maximum_discount numeric(10,2),
  validity_days    integer                  DEFAULT 60 NOT NULL,
  active           boolean                  DEFAULT true NOT NULL,
  sort_order       integer                  DEFAULT 0 NOT NULL,
  created_at       timestamp with time zone DEFAULT now() NOT NULL,
  updated_at       timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.kweider_reward_definitions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_reward_definitions
  ADD CONSTRAINT kweider_reward_definitions_pkey PRIMARY KEY (code);

ALTER TABLE public.kweider_member_rewards
  ADD CONSTRAINT kweider_member_rewards_reward_code_fkey FOREIGN KEY (reward_code) REFERENCES public.kweider_reward_definitions(code);

ALTER TABLE public.kweider_reward_definitions
  ADD CONSTRAINT kweider_reward_definitions_reward_kind_check CHECK (reward_kind = ANY (ARRAY['percent_discount'::text, 'breakfast_for_two'::text]));

ALTER TABLE public.kweider_reward_definitions
  ADD CONSTRAINT kweider_reward_definitions_threshold_points_check CHECK (threshold_points > 0);

ALTER TABLE public.kweider_reward_definitions
  ADD CONSTRAINT kweider_reward_definitions_validity_days_check CHECK (validity_days > 0);

GRANT ALL ON public.kweider_reward_definitions TO service_role;

CREATE TABLE public.kweider_staff_profiles (
  user_id      uuid                     NOT NULL,
  display_name text                     NOT NULL,
  staff_role   text                     DEFAULT 'staff'::text NOT NULL,
  active       boolean                  DEFAULT true NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.kweider_staff_profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_staff_profiles
  FORCE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_staff_profiles
  ADD CONSTRAINT kweider_staff_profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE public.kweider_staff_profiles
  ADD CONSTRAINT kweider_staff_profiles_staff_role_check CHECK (staff_role = ANY (ARRAY['staff'::text, 'manager'::text, 'admin'::text]));

ALTER TABLE public.kweider_staff_profiles
  ADD CONSTRAINT kweider_staff_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.kweider_staff_profiles TO service_role;

CREATE TABLE public.kweider_welcome_coffees (
  id                       uuid                     DEFAULT gen_random_uuid() NOT NULL,
  member_id                uuid                     NOT NULL,
  status                   text                     DEFAULT 'available'::text NOT NULL,
  issued_at                timestamp with time zone DEFAULT now() NOT NULL,
  expires_at               timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
  redeemed_at              timestamp with time zone,
  redeemed_by_user_id      uuid,
  redeemed_by_name         text,
  purchase_amount          numeric(12,2),
  receipt_reference        text,
  checkout_idempotency_key text,
  created_at               timestamp with time zone DEFAULT now() NOT NULL,
  updated_at               timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.kweider_welcome_coffees
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.kweider_welcome_coffees
  ADD CONSTRAINT kweider_welcome_coffees_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.kweider_members(id) ON DELETE CASCADE;

ALTER TABLE public.kweider_welcome_coffees
  ADD CONSTRAINT kweider_welcome_coffees_member_id_key UNIQUE (member_id);

ALTER TABLE public.kweider_welcome_coffees
  ADD CONSTRAINT kweider_welcome_coffees_pkey PRIMARY KEY (id);

ALTER TABLE public.kweider_welcome_coffees
  ADD CONSTRAINT kweider_welcome_coffees_status_check CHECK (status = ANY (ARRAY['available'::text, 'redeemed'::text, 'expired'::text, 'cancelled'::text]));

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.kweider_welcome_coffees TO anon;

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON public.kweider_welcome_coffees TO authenticated;

GRANT ALL ON public.kweider_welcome_coffees TO service_role;

CREATE INDEX kweider_welcome_coffees_status_expiry_idx ON public.kweider_welcome_coffees (status, expires_at);

CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
