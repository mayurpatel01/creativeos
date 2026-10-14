// One-off migration: rename the UK country code to GBR on existing designs.
// Updates country and suggested_filename, and moves any stored image to the
// matching new path. Safe to re-run: only rows still marked UK are touched.
//
//   node --env-file=.env.local scripts/rename-uk-to-gbr.ts

import { DESIGN_BUCKET, designObjectUrl, designStoragePath } from "../lib/design-storage.ts";
import { getSupabaseAdmin } from "../lib/supabase.ts";

const OLD_CODE = "UK";
const NEW_CODE = "GBR";

const supabase = getSupabaseAdmin();

const { data: rows, error } = await supabase
  .from("assets")
  .select("id, design_number, god, suggested_filename, file_path")
  .eq("country", OLD_CODE)
  .order("design_number");
if (error) throw error;

if (rows.length === 0) {
  console.log(`No ${OLD_CODE} designs left to rename.`);
  process.exit(0);
}

let renamed = 0;
const failures: string[] = [];

for (const row of rows) {
  const label = `#${row.design_number} ${row.suggested_filename}`;
  const newFilename = row.suggested_filename.replace(`_USA-${OLD_CODE}_`, `_USA-${NEW_CODE}_`);
  if (newFilename === row.suggested_filename) {
    failures.push(`${label}: filename doesn't contain _USA-${OLD_CODE}_`);
    continue;
  }

  let newPath: string | null = null;
  if (row.file_path) {
    newPath = designStoragePath(row.god, newFilename);
    const { error: moveError } = await supabase.storage.from(DESIGN_BUCKET).move(row.file_path, newPath);
    if (moveError) {
      failures.push(`${label}: couldn't move image: ${moveError.message}`);
      continue;
    }
  }

  const { error: updateError } = await supabase
    .from("assets")
    .update({
      country: NEW_CODE,
      suggested_filename: newFilename,
      ...(newPath && {
        file_path: newPath,
        file_url: designObjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, newPath),
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("country", OLD_CODE);

  if (updateError) {
    // Put the image back so the row and the file still match.
    if (row.file_path && newPath) {
      await supabase.storage.from(DESIGN_BUCKET).move(newPath, row.file_path);
    }
    failures.push(`${label}: couldn't update row: ${updateError.message}`);
    continue;
  }

  renamed++;
  console.log(`${label} → ${newFilename}${newPath ? " (image moved)" : ""}`);
}

console.log(`Renamed ${renamed} of ${rows.length} ${OLD_CODE} designs to ${NEW_CODE}.`);
if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
