# KWEIDER Menu Control Panel

## Scope

This feature is isolated to café menu management only.

Protected systems that must not be changed by this work:

- Rewards
- customers
- loyalty points
- checkout
- QR URLs
- push notifications
- service worker
- existing product image files
- visual identity / CSS presentation

## Source of truth

The target source of truth for editable menu content is `public.kweider_menu_products`.

The menu presentation remains responsible for rendering the existing KWEIDER visual design. The control panel manages content data only.

## Product fields

Each product uses a stable internal Product ID and retains its category.

Editable menu fields:

- Product ID (fixed; not user-editable)
- Category
- English name
- Arabic name
- Price
- Portion text
- English description
- Arabic description
- Allergy information
- Image path reference
- Availability status: `available`, `sold_out`, `hidden`
- NEW flag
- Sort order

## Availability behaviour

- `available`: product displays normally.
- `sold_out`: product remains visible with `Sold Out | نفد حالياً`.
- `hidden`: product is omitted from the customer menu.

## Draft and publish

Admin changes should not go live while fields are being edited.

1. Admin edits a product.
2. Changes are saved as a draft.
3. Admin reviews the draft.
4. Admin publishes explicitly.
5. Customer menu reads the published product record.

## Audit trail

Each publish or availability change should record:

- Product ID
- before value
- after value
- timestamp
- admin identifier

## Category preservation

The current customer-menu categories must remain intact. The admin interface should group products by the same categories so staff never work from one long 143-item list.

Current category codes:

- SO — Special Offers
- BF — Breakfast Selection
- DN — Dinner Selection
- KF — Authentic Kunafa
- PS — Premium Sweets
- CE — Cake & Eclair
- MC — Milk & Cheesecake
- FD — Fruits & Dubai Choc
- IC — Authentic Ice Cream
- CD — Cold Drinks & Juices
- HD — Hot Drinks

## Deployment rule

All development must remain off `main` until tested and explicitly approved. The working branch for this feature is `dev/menu-control-panel`.
