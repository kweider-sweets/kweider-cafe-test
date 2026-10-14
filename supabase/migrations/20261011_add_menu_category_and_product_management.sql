-- KWEIDER Menu Control: category visibility + adding products/categories.
-- Applied to kweider-rewards-test before this file was committed.

create table if not exists public.kweider_menu_categories (
  category_code text primary key,
  name_en text not null,
  name_ar text,
  section_id text not null unique,
  image_path text,
  is_visible boolean not null default true,
  show_in_home boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kweider_menu_categories_code_chk check (category_code ~ '^[A-Z0-9]{2,6}$'),
  constraint kweider_menu_categories_section_chk check (section_id ~ '^[a-z0-9-]+$')
);

-- Existing menu categories are seeded by the applied migration; keep future environments aligned.
insert into public.kweider_menu_categories(category_code,name_en,name_ar,section_id,image_path,is_visible,show_in_home,sort_order)
values
('SO','Kweider Special Offers','عروض قويدر الخاصة','special-offers','classic-kunafa-coffee-combo.webp',true,false,0),
('BF','Breakfast Selection','الفطور الشامي','breakfast','single-serving-selection.webp',true,true,10),
('DN','Dinner Selection','العشاء الشامي','dinner','damascus-heritage-dinner-3.webp',true,true,20),
('KF','Authentic Kunafa','الكنافة الدمشقية','kunafa','pistachio-kunafa-2.webp',true,true,30),
('PS','Premium Sweets','الحلويات الفاخرة','premium-sweets','madlouka.webp',true,true,40),
('CE','Cake & Eclair','كيك وإكلير','cake-eclair','chocolate-eclair.webp',true,true,50),
('MC','Milk & Cheesecake','ميلك كيك وتشيزكيك','milk-cheesecake','mahalapye.webp',true,true,60),
('FD','Fruits & Dubai Choc','الفواكه وشوكولاتة دبي','fruits-dubai','dubai-cup.webp',true,true,70),
('IC','Authentic Ice Cream','البوظة العربية','ice-cream','arabic-icecream.webp',true,true,80),
('CD','Cold Drinks & Juices','المشروبات الباردة والعصائر','cold-drinks','milkshake-2026.webp',true,true,90),
('HD','Hot Drinks','المشروبات الساخنة','hot-drinks','arabic-coffee.webp',true,true,100)
on conflict (category_code) do update set
  name_en=excluded.name_en,name_ar=excluded.name_ar,section_id=excluded.section_id,
  image_path=excluded.image_path,show_in_home=excluded.show_in_home,
  sort_order=excluded.sort_order,updated_at=now();

alter table public.kweider_menu_categories enable row level security;

drop policy if exists kweider_menu_categories_public_read on public.kweider_menu_categories;
create policy kweider_menu_categories_public_read on public.kweider_menu_categories
for select to anon,authenticated using (true);

drop policy if exists kweider_menu_categories_admin_insert on public.kweider_menu_categories;
create policy kweider_menu_categories_admin_insert on public.kweider_menu_categories
for insert to authenticated with check (public.is_kweider_menu_admin());

drop policy if exists kweider_menu_categories_admin_update on public.kweider_menu_categories;
create policy kweider_menu_categories_admin_update on public.kweider_menu_categories
for update to authenticated using (public.is_kweider_menu_admin()) with check (public.is_kweider_menu_admin());

grant select on public.kweider_menu_categories to anon,authenticated;
grant insert,update on public.kweider_menu_categories to authenticated;

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
  v_product_id:='KWD-'||v_category.category_code||'-'||lpad(v_next::text,3,'0');
  insert into public.kweider_menu_items(product_id,category_code,category_name,name_en,name_ar,price,portion_text,description_en,description_ar,allergy_information,image_path,availability_status,is_new,sort_order,version,created_at,updated_at)
  values(v_product_id,v_category.category_code,v_category.name_en,trim(p_name_en),nullif(trim(p_name_ar),''),p_price,null,nullif(trim(p_description_en),''),nullif(trim(p_description_ar),''),nullif(trim(p_allergy_information),''),nullif(trim(p_image_path),''),p_availability_status,coalesce(p_is_new,false),v_next,1,now(),now()) returning * into v_row;
  insert into public.kweider_menu_drafts(product_id,category_code,category_name,name_en,name_ar,price,portion_text,description_en,description_ar,allergy_information,image_path,availability_status,is_new,sort_order,base_version,updated_at)
  values(v_row.product_id,v_row.category_code,v_row.category_name,v_row.name_en,v_row.name_ar,v_row.price,v_row.portion_text,v_row.description_en,v_row.description_ar,v_row.allergy_information,v_row.image_path,v_row.availability_status,v_row.is_new,v_row.sort_order,v_row.version,now())
  on conflict(product_id) do update set category_code=excluded.category_code,category_name=excluded.category_name,name_en=excluded.name_en,name_ar=excluded.name_ar,price=excluded.price,description_en=excluded.description_en,description_ar=excluded.description_ar,allergy_information=excluded.allergy_information,image_path=excluded.image_path,availability_status=excluded.availability_status,is_new=excluded.is_new,sort_order=excluded.sort_order,base_version=excluded.base_version,updated_at=now();
  insert into public.kweider_menu_change_log(product_id,action,changed_fields,changed_by)
  values(v_product_id,'product_created',jsonb_build_object('category_code',v_category.category_code,'name_en',v_row.name_en,'price',v_row.price,'status',v_row.availability_status),auth.uid());
  return v_row;
end;$$;

grant execute on function public.create_kweider_menu_item(text,text,text,numeric,text,text,text,text,text,boolean) to authenticated;
