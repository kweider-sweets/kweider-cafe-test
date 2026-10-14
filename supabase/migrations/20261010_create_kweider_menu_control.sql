-- KWEIDER Menu Control Panel
-- Isolated from Rewards, customers, loyalty points, checkout, QR and push systems.
-- This migration is intentionally limited to new menu-control tables only.

create table if not exists public.kweider_menu_products (
    product_id text primary key,
    category_code text not null,
    category_name text not null,
    name_en text not null,
    name_ar text not null,
    price_gbp numeric(10,2) not null check (price_gbp >= 0),
    portion_text text,
    description_en text,
    description_ar text,
    allergy_info text,
    image_path text,
    status text not null default 'available' check (status in ('available','sold_out','hidden')),
    is_new boolean not null default false,
    sort_order integer not null default 0,
    is_published boolean not null default true,
    updated_at timestamptz not null default now(),
    updated_by text
);

create index if not exists kweider_menu_products_category_sort_idx
    on public.kweider_menu_products (category_code, sort_order, product_id);

create index if not exists kweider_menu_products_public_idx
    on public.kweider_menu_products (is_published, status, category_code, sort_order);

create table if not exists public.kweider_menu_product_drafts (
    product_id text primary key references public.kweider_menu_products(product_id) on delete cascade,
    draft_data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    updated_by text
);

create table if not exists public.kweider_menu_change_log (
    id bigint generated always as identity primary key,
    product_id text not null,
    action text not null check (action in ('create','save_draft','publish','status_change')),
    before_data jsonb,
    after_data jsonb,
    changed_at timestamptz not null default now(),
    changed_by text
);

-- Public menu may read published menu data only.
alter table public.kweider_menu_products enable row level security;
alter table public.kweider_menu_product_drafts enable row level security;
alter table public.kweider_menu_change_log enable row level security;

create policy "public_read_published_kweider_menu"
    on public.kweider_menu_products
    for select
    to anon, authenticated
    using (is_published = true);

-- Deliberately no browser-side INSERT/UPDATE/DELETE policies are created here.
-- Admin writes must later go through a separately protected admin path.
-- This avoids granting any access to existing Rewards/customer/points/auth data.

comment on table public.kweider_menu_products is
    'KWEIDER cafe menu master data only. Independent of Rewards/customer/loyalty systems.';
comment on table public.kweider_menu_product_drafts is
    'Draft edits for KWEIDER menu products prior to publish.';
comment on table public.kweider_menu_change_log is
    'Audit trail for KWEIDER menu-control changes.';
