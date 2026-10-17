-- Add final_approved_at to assets for the master approval screen.
-- This is separate from the per-mockup mockup_reviewed_at and the Gelato
-- status fields: it records the admin's single "everything looks good, ship it"
-- decision per design.

alter table assets
  add column if not exists final_approved_at timestamptz;

comment on column assets.final_approved_at is
  'Set when the admin gives final approval on the master screen (all three images checked).';
