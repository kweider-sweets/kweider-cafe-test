create table if not exists public.kweider_registration_rate_events (
  id bigint generated always as identity primary key,
  key_type text not null check (key_type in ('phone', 'ip')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists kweider_registration_rate_events_lookup_idx
  on public.kweider_registration_rate_events (key_type, key_hash, created_at desc);

create index if not exists kweider_registration_rate_events_created_at_idx
  on public.kweider_registration_rate_events (created_at);

alter table public.kweider_registration_rate_events enable row level security;
revoke all on table public.kweider_registration_rate_events from anon, authenticated;

create or replace function public.kweider_check_registration_rate_limit(
  p_phone_hash text,
  p_ip_hash text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone_count integer := 0;
  v_ip_count integer := 0;
  v_phone_oldest timestamptz;
  v_ip_oldest timestamptz;
  v_retry_after integer := 0;
begin
  if p_phone_hash is null or p_phone_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_PHONE_HASH';
  end if;

  if coalesce(p_ip_hash, '') <> '' and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_IP_HASH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kweider:registration:phone:' || p_phone_hash, 0));

  if coalesce(p_ip_hash, '') <> '' then
    perform pg_advisory_xact_lock(hashtextextended('kweider:registration:ip:' || p_ip_hash, 0));
  end if;

  select count(*)::integer, min(created_at)
    into v_phone_count, v_phone_oldest
  from public.kweider_registration_rate_events
  where key_type = 'phone'
    and key_hash = p_phone_hash
    and created_at > p_now - interval '15 minutes';

  if v_phone_count >= 5 then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from ((v_phone_oldest + interval '15 minutes') - p_now)))::integer
    );

    return jsonb_build_object(
      'allowed', false,
      'scope', 'phone',
      'limit', 5,
      'window_seconds', 900,
      'retry_after_seconds', v_retry_after
    );
  end if;

  if coalesce(p_ip_hash, '') <> '' then
    select count(*)::integer, min(created_at)
      into v_ip_count, v_ip_oldest
    from public.kweider_registration_rate_events
    where key_type = 'ip'
      and key_hash = p_ip_hash
      and created_at > p_now - interval '1 hour';

    if v_ip_count >= 100 then
      v_retry_after := greatest(
        1,
        ceil(extract(epoch from ((v_ip_oldest + interval '1 hour') - p_now)))::integer
      );

      return jsonb_build_object(
        'allowed', false,
        'scope', 'ip',
        'limit', 100,
        'window_seconds', 3600,
        'retry_after_seconds', v_retry_after
      );
    end if;
  end if;

  insert into public.kweider_registration_rate_events (key_type, key_hash, created_at)
  values ('phone', p_phone_hash, p_now);

  if coalesce(p_ip_hash, '') <> '' then
    insert into public.kweider_registration_rate_events (key_type, key_hash, created_at)
    values ('ip', p_ip_hash, p_now);
  end if;

  delete from public.kweider_registration_rate_events
  where created_at < p_now - interval '24 hours';

  return jsonb_build_object(
    'allowed', true,
    'scope', null,
    'phone_count', v_phone_count + 1,
    'ip_count', case when coalesce(p_ip_hash, '') <> '' then v_ip_count + 1 else null end
  );
end;
$$;

revoke all on function public.kweider_check_registration_rate_limit(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.kweider_check_registration_rate_limit(text, text, timestamptz) to service_role;
