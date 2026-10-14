-- Gelato product tracking on assets, and the gelato_pending asset status.
-- Run in the Supabase SQL editor (or `supabase db push` once the project is linked).

alter table public.assets
  add column if not exists gelato_product_id text,
  add column if not exists gelato_product_url text,
  add column if not exists gelato_status text,
  add column if not exists gelato_created_at timestamptz;

alter table public.assets drop constraint if exists assets_gelato_status_check;
alter table public.assets
  add constraint assets_gelato_status_check
  check (gelato_status is null or gelato_status in ('pending', 'active', 'error'));

-- One Gelato product per asset.
create unique index if not exists assets_gelato_product_id_key
  on public.assets (gelato_product_id)
  where gelato_product_id is not null;

-- Allow the new status. The existing check rejects 'gelato_pending'. If this
-- fails, a row has a status not listed here: add it to the list and re-run.
alter table public.assets drop constraint if exists assets_status_check;
alter table public.assets
  add constraint assets_status_check
  check (status in (
    'not_started',
    'dalle_done',
    'upscaled',
    'ready_for_review',
    'approved',
    'rejected',
    'gelato_pending'
  ));
