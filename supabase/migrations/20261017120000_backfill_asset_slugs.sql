-- Backfill URL-safe slugs for all assets that are missing one.
-- Format: <god>-<country>-<size_variant>-<design_number>
-- e.g. ganesh-usa-india-full-1001
--
-- Rules:
--   - lowercase
--   - non-alphanumeric chars → hyphen
--   - collapse multiple hyphens
--   - strip leading/trailing hyphens
--   - guaranteed unique via design_number suffix

UPDATE assets
SET slug = (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(
          coalesce(god, 'design') || '-' ||
          coalesce(country, 'unknown') || '-' ||
          coalesce(lower(size_variant), '') || '-' ||
          design_number::text
        ),
        '[^a-z0-9]+', '-', 'g'   -- non-alphanumeric → hyphen
      ),
      '-+', '-', 'g'             -- collapse multiple hyphens
    ),
    '^-|-$', '', 'g'             -- strip leading/trailing hyphens
  )
)
WHERE slug IS NULL
  AND design_number IS NOT NULL;

-- Also fix any slugs that were set to the display name (contain spaces or ×)
UPDATE assets
SET slug = (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(
          coalesce(god, 'design') || '-' ||
          coalesce(country, 'unknown') || '-' ||
          coalesce(lower(size_variant), '') || '-' ||
          design_number::text
        ),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-+', '-', 'g'
    ),
    '^-|-$', '', 'g'
  )
)
WHERE design_number IS NOT NULL
  AND (slug ~ '\s' OR slug ~ '×' OR slug ~ '[()]');

COMMENT ON COLUMN assets.slug IS 'URL-safe identifier: <god>-<country>-<size_variant>-<design_number>  e.g. ganesh-usa-india-full-1001';
