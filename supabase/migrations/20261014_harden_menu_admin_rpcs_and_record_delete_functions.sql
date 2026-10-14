-- KWEIDER Menu Control hardening.
-- Scope: menu-control RPC permissions and reproducible delete RPC definitions only.
-- No Rewards, customer, loyalty, checkout, or points data is touched.

create or replace function public.delete_kweider_menu_item(
  p_product_id text,
  p_confirm_product_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.kweider_menu_items%rowtype;
begin
  if not public.is_kweider_menu_admin() then
    raise exception 'Menu Admin authorisation required';
  end if;

  if coalesce(trim(p_product_id),'') = ''
     or p_confirm_product_id is distinct from p_product_id then
    raise exception 'Product ID confirmation does not match';
  end if;

  select * into v_item
  from public.kweider_menu_items
  where product_id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  delete from public.kweider_menu_drafts
  where product_id = p_product_id;

  delete from public.kweider_menu_items
  where product_id = p_product_id;

  return true;
end;
$$;

create or replace function public.delete_kweider_menu_category(
  p_category_code text,
  p_confirm_category_code text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category public.kweider_menu_categories%rowtype;
  v_count integer;
  v_code text := upper(trim(p_category_code));
begin
  if not public.is_kweider_menu_admin() then
    raise exception 'Menu Admin authorisation required';
  end if;

  if coalesce(v_code,'') = ''
     or upper(trim(p_confirm_category_code)) is distinct from v_code then
    raise exception 'Category code confirmation does not match';
  end if;

  select * into v_category
  from public.kweider_menu_categories
  where category_code = v_code;

  if not found then
    raise exception 'Category not found';
  end if;

  if v_category.is_visible then
    raise exception 'Hide the category before deleting it';
  end if;

  select count(*) into v_count
  from public.kweider_menu_items
  where category_code = v_code;

  if v_count > 0 then
    raise exception 'Delete all products in this category first';
  end if;

  delete from public.kweider_menu_categories
  where category_code = v_code;

  return true;
end;
$$;

revoke all on function public.create_kweider_menu_item(text,text,text,numeric,text,text,text,text,text,boolean) from public;
revoke all on function public.delete_kweider_menu_item(text,text) from public;
revoke all on function public.delete_kweider_menu_category(text,text) from public;

grant execute on function public.create_kweider_menu_item(text,text,text,numeric,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.delete_kweider_menu_item(text,text) to authenticated;
grant execute on function public.delete_kweider_menu_category(text,text) to authenticated;
