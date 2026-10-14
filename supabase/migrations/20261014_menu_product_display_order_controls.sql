-- KWEIDER Menu Control: product display ordering.
-- Scope is limited to menu-control product creation behaviour.
-- New products are assigned a sort_order before the current first item in their category.

create or replace function public.create_kweider_menu_item(
  p_category_code text,p_name_en text,p_name_ar text default null,p_price numeric default 0,
  p_description_en text default null,p_description_ar text default null,
  p_allergy_information text default null,p_image_path text default null,
  p_availability_status text default 'hidden',p_is_new boolean default false
) returns public.kweider_menu_items
language plpgsql security definer set search_path=public as $$
declare
  v_category public.kweider_menu_categories%rowtype;
  v_next integer;
  v_sort_order integer;
  v_product_id text;
  v_row public.kweider_menu_items%rowtype;
begin
  if not public.is_kweider_menu_admin() then raise exception 'Menu Admin authorisation required'; end if;
  if coalesce(trim(p_name_en),'')='' then raise exception 'English name is required'; end if;
  if p_price<0 then raise exception 'Price cannot be negative'; end if;
  if p_availability_status not in ('available','sold_out','hidden') then raise exception 'Invalid availability status'; end if;

  select * into v_category from public.kweider_menu_categories where category_code=upper(trim(p_category_code));
  if not found then raise exception 'Category not found'; end if;

  perform pg_advisory_xact_lock(hashtext('kweider-menu-'||v_category.category_code));

  select coalesce(max((regexp_match(product_id,'-([0-9]+)$'))[1]::int),0)+1 into v_next
  from public.kweider_menu_items where category_code=v_category.category_code;

  select coalesce(min(sort_order),10)-10 into v_sort_order
  from public.kweider_menu_items where category_code=v_category.category_code;

  v_product_id:='KWD-'||v_category.category_code||'-'||lpad(v_next::text,3,'0');

  insert into public.kweider_menu_items(product_id,category_code,category_name,name_en,name_ar,price,portion_text,description_en,description_ar,allergy_information,image_path,availability_status,is_new,sort_order,version,created_at,updated_at)
  values(v_product_id,v_category.category_code,v_category.name_en,trim(p_name_en),nullif(trim(p_name_ar),''),p_price,null,nullif(trim(p_description_en),''),nullif(trim(p_description_ar),''),nullif(trim(p_allergy_information),''),nullif(trim(p_image_path),''),p_availability_status,coalesce(p_is_new,false),v_sort_order,1,now(),now()) returning * into v_row;

  insert into public.kweider_menu_drafts(product_id,category_code,category_name,name_en,name_ar,price,portion_text,description_en,description_ar,allergy_information,image_path,availability_status,is_new,sort_order,base_version,updated_at)
  values(v_row.product_id,v_row.category_code,v_row.category_name,v_row.name_en,v_row.name_ar,v_row.price,v_row.portion_text,v_row.description_en,v_row.description_ar,v_row.allergy_information,v_row.image_path,v_row.availability_status,v_row.is_new,v_row.sort_order,v_row.version,now())
  on conflict(product_id) do update set category_code=excluded.category_code,category_name=excluded.category_name,name_en=excluded.name_en,name_ar=excluded.name_ar,price=excluded.price,description_en=excluded.description_en,description_ar=excluded.description_ar,allergy_information=excluded.allergy_information,image_path=excluded.image_path,availability_status=excluded.availability_status,is_new=excluded.is_new,sort_order=excluded.sort_order,base_version=excluded.base_version,updated_at=now();

  insert into public.kweider_menu_change_log(product_id,action,changed_fields,changed_by)
  values(v_product_id,'product_created',jsonb_build_object('category_code',v_category.category_code,'name_en',v_row.name_en,'price',v_row.price,'status',v_row.availability_status,'sort_order',v_row.sort_order),auth.uid());

  return v_row;
end;$$;

revoke all on function public.create_kweider_menu_item(text,text,text,numeric,text,text,text,text,text,boolean) from public;
grant execute on function public.create_kweider_menu_item(text,text,text,numeric,text,text,text,text,text,boolean) to authenticated;
