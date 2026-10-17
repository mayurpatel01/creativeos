-- Audit log for every design regeneration.
-- Records who triggered it, why, and what the old file was, so we can
-- answer "what was design #X before the reprint on date Y?" and
-- tie regeneration events to customer complaints or quality issues.

create table if not exists design_regenerations (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references assets(id) on delete cascade,
  design_number   int,
  triggered_by    text not null default 'admin',  -- 'admin' | agent name | api key label
  reason          text,                            -- free-text reason entered at the time
  old_file_path   text,                            -- archived path of the old design image
  old_status      text,                            -- status at the time of reset
  created_at      timestamptz not null default now()
);

-- Fast lookups by design
create index if not exists design_regenerations_asset_id_idx
  on design_regenerations (asset_id, created_at desc);

comment on table design_regenerations is
  'One row per design regeneration: who did it, why, and what the old image was.';
comment on column design_regenerations.old_file_path is
  'The file_path before reset — the file itself is deleted from storage but this path stays as a record.';
comment on column design_regenerations.reason is
  'Free-text reason entered by the admin at regeneration time (e.g. "white background", "wrong style", "customer complaint #123").';
