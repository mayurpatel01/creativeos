-- Add SEO fields to blog_posts table
-- target_keyword: the primary keyword Aisha targeted when writing the post
-- Allows the admin UI to show keyword coverage and spot gaps

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS target_keyword text;

COMMENT ON COLUMN blog_posts.target_keyword IS 'Primary SEO keyword phrase this post was written to rank for';
