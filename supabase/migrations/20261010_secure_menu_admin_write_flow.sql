create table if not exists public.kweider_menu_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.kweider_menu_admins enable row level security;

create or replace function public.is_kweider_menu_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.kweider_menu_admins a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_kweider_menu_admin() from public;
grant execute on function public.is_kweider_menu_admin() to authenticated;

create policy "menu admins can read drafts"
  on public.kweider_menu_drafts for select to authenticated
  using (public.is_kweider_menu_admin());

create policy "menu admins can insert drafts"
  on public.kweider_menu_drafts for insert to authenticated
  with check (public.is_kweider_menu_admin());

create policy "menu admins can update drafts"
  on public.kweider_menu_drafts for update to authenticated
  using (public.is_kweider_menu_admin())
  with check (public.is_kweider_menu_admin());

create policy "menu admins can delete drafts"
  on public.kweider_menu_drafts for delete to authenticated
  using (public.is_kweider_menu_admin());

create policy "menu admins can read change log"
  on public.kweider_menu_change_log for select to authenticated
  using (public.is_kweider_menu_admin());

create policy "menu admins can insert change log"
  on public.kweider_menu_change_log for insert to authenticated
  with check (public.is_kweider_menu_admin());

grant select, insert, update, delete on public.kweider_menu_drafts to authenticated;
grant select, insert on public.kweider_menu_change_log to authenticated;
grant select on public.kweider_menu_items to anon, authenticated;

create or replace function public.publish_kweider_menu_item(p_product_id text)
returns public.kweider_menu_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.kweider_menu_drafts%rowtype;
  v_result public.kweider_menu_items%rowtype;
begin
  if not public.is_kweider_menu_admin() then
    raise exception 'not authorized';
  end if;

  select * into v_draft
  from public.kweider_menu_drafts
  where product_id = p_product_id;

  if not found then
    raise exception 'draft not found';
  end if;

  insert into public.kweider_menu_items (
    product_id, category_code, category_name, name_en, name_ar,
    price, portion_text, description_en, description_ar,
    allergy_information, image_path, availability_status, is_new,
    sort_order, version, created_at, updated_at, published_at
  ) values (
    v_draft.product_id, v_draft.category_code, v_draft.category_name,
    v_draft.name_en, v_draft.name_ar, v_draft.price, v_draft.portion_text,
    v_draft.description_en, v_draft.description_ar,
    v_draft.allergy_information, v_draft.image_path,
    v_draft.availability_status, v_draft.is_new, v_draft.sort_order,
    coalesce(v_draft.base_version, 0) + 1, now(), now(), now()
  )
  on conflict (product_id) do update set
    category_code = excluded.category_code,
    category_name = excluded.category_name,
    name_en = excluded.name_en,
    name_ar = excluded.name_ar,
    price = excluded.price,
    portion_text = excluded.portion_text,
    description_en = excluded.description_en,
    description_ar = excluded.description_ar,
    allergy_information = excluded.allergy_information,
    image_path = excluded.image_path,
    availability_status = excluded.availability_status,
    is_new = excluded.is_new,
    sort_order = excluded.sort_order,
    version = public.kweider_menu_items.version + 1,
    updated_at = now(),
    published_at = now()
  returning * into v_result;

  update public.kweider_menu_drafts
  set base_version = v_result.version,
      updated_at = now()
  where product_id = p_product_id;

  insert into public.kweider_menu_change_log(product_id, action, changed_fields, changed_by)
  values (p_product_id, 'published', jsonb_build_object('version', v_result.version), auth.uid());

  return v_result;
end;
$$;

revoke all on function public.publish_kweider_menu_item(text) from public;
grant execute on function public.publish_kweider_menu_item(text) to authenticated;
