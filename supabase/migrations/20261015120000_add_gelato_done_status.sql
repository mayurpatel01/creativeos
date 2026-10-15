-- The gelato_done asset status: set by /api/gelato/sync-status once Gelato
-- reports the product active. Run in the Supabase SQL editor (or
-- `supabase db push` once the project is linked), after
-- 20261014120000_add_gelato_fields_to_assets.sql.
--
-- If this fails, a row has a status not listed here: add it and re-run.
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
    'gelato_pending',
    'gelato_done'
  ));
