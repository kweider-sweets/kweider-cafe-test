CREATE OR REPLACE FUNCTION public.kweider_issue_rewards_and_messages(p_member_id uuid)
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
$function$
