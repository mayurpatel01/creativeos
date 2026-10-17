-- Catalog of Gelato product types we can create templates for.
-- One row per product category (t-shirt, hoodie, hat, tote, etc.).
-- The `gelato_product_catalog` table holds the specific Gelato UIDs
-- for each product+variant combination once we set up templates.

create table if not exists gelato_product_types (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,           -- machine key, e.g. 'tshirt-bella-3001'
  category        text not null,                  -- 'apparel', 'accessories', 'home'
  subcategory     text not null,                  -- 't-shirt', 'hoodie', 'hat', 'tote-bag', etc.
  name            text not null,                  -- display name, e.g. 'Unisex T-Shirt (Bella+Canvas 3001)'
  supplier        text,                           -- 'Bella+Canvas', 'Gildan', 'Richardson', etc.
  supplier_sku    text,                           -- e.g. '3001'
  print_areas     text[] not null default '{}',   -- e.g. ARRAY['front','back','sleeve']
  notes           text,
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);

-- Tracks which Gelato template IDs we've created for each product type.
-- When we expand to hats, totes, etc. each gets its own template UUID here.
create table if not exists gelato_templates (
  id                    uuid primary key default gen_random_uuid(),
  product_type_id       uuid not null references gelato_product_types(id),
  gelato_template_id    text not null unique,      -- Gelato's UUID
  label                 text not null,             -- e.g. 'Full Front – Black/White, S–3XL'
  print_location        text not null,             -- 'FULL', 'CHEST', 'BACK', 'ALL_OVER', etc.
  colors                text[] not null default '{}', -- e.g. ARRAY['Black','White']
  sizes                 text[] not null default '{}', -- e.g. ARRAY['S','M','L','XL','2XL','3XL']
  env_var               text,                      -- env var name, if referenced in code
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- -----------------------------------------------------------------------
-- Seed: product types Gelato supports that make sense for HinduTee.com
-- -----------------------------------------------------------------------

insert into gelato_product_types (slug, category, subcategory, name, supplier, supplier_sku, print_areas, notes, sort_order)
values
  -- ── Apparel ─────────────────────────────────────────────────────────
  ('tshirt-bella-3001',      'apparel', 't-shirt',  'Unisex T-Shirt (Bella+Canvas 3001)',       'Bella+Canvas', '3001',   ARRAY['front','back'],        'Best seller. Soft, retail fit. Black & White are our core.', 10),
  ('tshirt-bella-3001cvc',   'apparel', 't-shirt',  'Unisex CVC T-Shirt (Bella+Canvas 3001CVC)','Bella+Canvas', '3001CVC',ARRAY['front','back'],        'Heathered look, great for lighter designs.', 11),
  ('tshirt-gildan-5000',     'apparel', 't-shirt',  'Heavy Cotton T-Shirt (Gildan 5000)',        'Gildan',       '5000',   ARRAY['front','back'],        'Budget option, heavier weight.', 12),
  ('tshirt-womens-bella-6004','apparel','t-shirt',  'Women''s Relaxed T-Shirt (Bella+Canvas 6400)','Bella+Canvas','6400',  ARRAY['front','back'],        'Women''s cut.', 13),
  ('hoodie-bella-3719',      'apparel', 'hoodie',   'Unisex Sponge Fleece Hoodie (Bella+Canvas 3719)','Bella+Canvas','3719',ARRAY['front','back'],       'Premium fleece hoodie.', 20),
  ('hoodie-gildan-18500',    'apparel', 'hoodie',   'Heavy Blend Hoodie (Gildan 18500)',         'Gildan',       '18500',  ARRAY['front','back'],        'Affordable, popular fleece hoodie.', 21),
  ('crewneck-bella-3901',    'apparel', 'sweatshirt','Unisex Sponge Fleece Crewneck (Bella+Canvas 3901)','Bella+Canvas','3901',ARRAY['front','back'],    'Clean crewneck, pairs with deity art.', 22),
  ('longsleeve-bella-3501',  'apparel', 'long-sleeve','Unisex Long Sleeve (Bella+Canvas 3501)',  'Bella+Canvas', '3501',   ARRAY['front','back'],        'Good for cooler months.', 23),
  ('tanktop-bella-3480',     'apparel', 'tank-top', 'Unisex Jersey Tank (Bella+Canvas 3480)',    'Bella+Canvas', '3480',   ARRAY['front','back'],        'Summer option.', 24),
  ('kids-tshirt-bella-3001y','apparel', 't-shirt',  'Youth T-Shirt (Bella+Canvas 3001Y)',        'Bella+Canvas', '3001Y',  ARRAY['front','back'],        'Kids sizing. Great for gifting.', 25),
  -- ── Headwear ─────────────────────────────────────────────────────────
  ('hat-dad-otto-19-251',    'accessories','hat',   'Classic Dad Hat (Otto Cap 19-251)',          'Otto',         '19-251', ARRAY['front'],               'Unstructured, low profile. Embroidery or DTF patch on front.', 30),
  ('hat-snapback-otto-125-978','accessories','hat', 'Flat Bill Snapback (Otto Cap 125-978)',      'Otto',         '125-978',ARRAY['front','side'],        'Structured, flat brim snapback.', 31),
  ('hat-trucker-richardson-112','accessories','hat','Foam Trucker Hat (Richardson 112)',          'Richardson',   '112',    ARRAY['front'],               'Classic mesh-back trucker hat.', 32),
  ('beanie-carhartt-a18',    'accessories','beanie','Knit Beanie (Carhartt A18)',                 'Carhartt',     'A18',    ARRAY['front'],               'Embroidered patch area. Premium feel.', 33),
  -- ── Bags ─────────────────────────────────────────────────────────────
  ('tote-natural-6oz',       'accessories','tote-bag','Natural Canvas Tote Bag (6 oz)',           null,           null,     ARRAY['front','back'],        'Simple canvas tote, DTF printing.', 40),
  ('tote-premium-12oz',      'accessories','tote-bag','Premium Canvas Tote Bag (12 oz)',          null,           null,     ARRAY['front','back'],        'Heavier canvas, more structure.', 41),
  ('drawstring-bag',         'accessories','bag',   'Drawstring Bag',                             null,           null,     ARRAY['front'],               'Gym / festival style.', 42),
  -- ── Home & Lifestyle ─────────────────────────────────────────────────
  ('mug-11oz-ceramic',       'home',      'mug',    'Classic Ceramic Mug (11 oz)',                null,           null,     ARRAY['wrap'],                'Full wrap print or panel print.', 50),
  ('mug-15oz-ceramic',       'home',      'mug',    'Large Ceramic Mug (15 oz)',                  null,           null,     ARRAY['wrap'],                'Same as 11oz but larger.', 51),
  ('phone-case-tough',       'accessories','phone-case','Tough Phone Case',                       null,           null,     ARRAY['back'],                'Available for major iPhone & Samsung models.', 60),
  ('poster-12x18',           'home',      'poster', 'Art Print Poster (12×18 in)',                null,           null,     ARRAY['full'],                'Matte finish. Great for deity art.', 70),
  ('poster-18x24',           'home',      'poster', 'Art Print Poster (18×24 in)',                null,           null,     ARRAY['full'],                'Larger format wall art.', 71),
  ('canvas-print-12x12',     'home',      'canvas', 'Stretched Canvas Print (12×12 in)',          null,           null,     ARRAY['full'],                'Gallery-wrap canvas. Premium home decor.', 72),
  ('sticker-kiss-cut',       'accessories','sticker','Kiss-Cut Sticker Sheet',                    null,           null,     ARRAY['full'],                'Great upsell / accessory item.', 80)
on conflict (slug) do nothing;

-- Seed the two t-shirt templates already in use
insert into gelato_templates (product_type_id, gelato_template_id, label, print_location, colors, sizes, env_var)
select
  pt.id,
  '0b84fd43-7a70-49d6-85a4-c9d1a6c7b02a',
  'Unisex T-Shirt – Full Front – Black/White – S–2XL (Legacy)',
  'FULL',
  ARRAY['Black','White'],
  ARRAY['S','M','L','XL','2XL'],
  null
from gelato_product_types pt
where pt.slug = 'tshirt-bella-3001'
on conflict (gelato_template_id) do nothing;

comment on table gelato_product_types is
  'Product types we can create Gelato templates for. Add a row here first, then create the template in Gelato and add it to gelato_templates.';
comment on table gelato_templates is
  'Specific Gelato template IDs tied to product types. One template = one product + print location + color/size set.';
