-- Track when mockups were last reviewed by an admin.
-- Assets with mockup URLs but NULL mockup_reviewed_at appear in the review queue.
-- Clearing a mockup URL (to regenerate it) also clears this so the asset
-- re-enters the queue once Bipasha generates fresh images.

alter table public.assets
  add column if not exists mockup_reviewed_at timestamptz;
