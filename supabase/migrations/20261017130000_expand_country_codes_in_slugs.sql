-- Expand 3-letter country codes to full names in asset slugs for better SEO.
-- Before: ganesh-ind-full-1001
-- After:  ganesh-india-full-1001

UPDATE assets SET slug = regexp_replace(slug, '-ind-',  '-india-',              'g') WHERE slug ~ '-ind-';
UPDATE assets SET slug = regexp_replace(slug, '-guy-',  '-guyana-',             'g') WHERE slug ~ '-guy-';
UPDATE assets SET slug = regexp_replace(slug, '-tri-',  '-trinidad-tobago-',    'g') WHERE slug ~ '-tri-';
UPDATE assets SET slug = regexp_replace(slug, '-fij-',  '-fiji-',               'g') WHERE slug ~ '-fij-';
UPDATE assets SET slug = regexp_replace(slug, '-mau-',  '-mauritius-',          'g') WHERE slug ~ '-mau-';
UPDATE assets SET slug = regexp_replace(slug, '-can-',  '-canada-',             'g') WHERE slug ~ '-can-';
UPDATE assets SET slug = regexp_replace(slug, '-gbr-',  '-united-kingdom-',     'g') WHERE slug ~ '-gbr-';
UPDATE assets SET slug = regexp_replace(slug, '-aus-',  '-australia-',          'g') WHERE slug ~ '-aus-';
UPDATE assets SET slug = regexp_replace(slug, '-sur-',  '-suriname-',           'g') WHERE slug ~ '-sur-';
UPDATE assets SET slug = regexp_replace(slug, '-rsa-',  '-south-africa-',       'g') WHERE slug ~ '-rsa-';
UPDATE assets SET slug = regexp_replace(slug, '-tza-',  '-tanzania-',           'g') WHERE slug ~ '-tza-';
UPDATE assets SET slug = regexp_replace(slug, '-ken-',  '-kenya-',              'g') WHERE slug ~ '-ken-';
UPDATE assets SET slug = regexp_replace(slug, '-zmb-',  '-zambia-',             'g') WHERE slug ~ '-zmb-';
UPDATE assets SET slug = regexp_replace(slug, '-nzl-',  '-new-zealand-',        'g') WHERE slug ~ '-nzl-';
UPDATE assets SET slug = regexp_replace(slug, '-nld-',  '-netherlands-',        'g') WHERE slug ~ '-nld-';
UPDATE assets SET slug = regexp_replace(slug, '-mex-',  '-mexico-',             'g') WHERE slug ~ '-mex-';
