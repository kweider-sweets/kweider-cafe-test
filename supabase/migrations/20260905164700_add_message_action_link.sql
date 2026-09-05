-- Add an optional action button to Kweider Rewards member messages.
-- Existing messages remain unchanged because both columns default to NULL.

alter table public.kweider_member_messages
  add column if not exists action_label text,
  add column if not exists action_url text;

alter table public.kweider_member_messages
  drop constraint if exists kweider_member_messages_action_pair_check;

alter table public.kweider_member_messages
  add constraint kweider_member_messages_action_pair_check
  check (
    (action_label is null and action_url is null)
    or (
      nullif(btrim(action_label), '') is not null
      and nullif(btrim(action_url), '') is not null
    )
  );

alter table public.kweider_member_messages
  drop constraint if exists kweider_member_messages_action_label_length_check;

alter table public.kweider_member_messages
  add constraint kweider_member_messages_action_label_length_check
  check (action_label is null or char_length(action_label) <= 40);

alter table public.kweider_member_messages
  drop constraint if exists kweider_member_messages_action_url_length_check;

alter table public.kweider_member_messages
  add constraint kweider_member_messages_action_url_length_check
  check (action_url is null or char_length(action_url) <= 500);

alter table public.kweider_member_messages
  drop constraint if exists kweider_member_messages_action_url_https_check;

alter table public.kweider_member_messages
  add constraint kweider_member_messages_action_url_https_check
  check (action_url is null or action_url ~* '^https://');
