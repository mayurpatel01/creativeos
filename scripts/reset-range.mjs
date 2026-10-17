/**
 * Bulk-reset designs by design_number range.
 *
 * Deletes each design's file from the storage bucket, clears the public copy
 * (if any), and resets the DB row back to not_started so Kajol re-queues it.
 * Also clears mockups so Bipasha re-runs after the new image is approved.
 *
 * Usage (from the creativeos directory):
 *   node scripts/reset-range.mjs --from 1102 --to 1172
 *   node scripts/reset-range.mjs --from 1102 --to 1172 --dry-run
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env,
 * or a .env.local file in the current directory.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}
const FROM = parseInt(flag("--from") ?? "", 10);
const TO   = parseInt(flag("--to")   ?? "", 10);
const DRY  = args.includes("--dry-run");

if (isNaN(FROM) || isNaN(TO)) {
  console.error("Usage: node scripts/reset-range.mjs --from <n> --to <n> [--dry-run]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load env (try .env.local and .env from cwd, then process.env)
// ---------------------------------------------------------------------------
for (const name of [".env.local", ".env"]) {
  try {
    const envPath = resolve(process.cwd(), name);
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
    break; // stop after first file found
  } catch { /* try next */ }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const DESIGN_BUCKET = "assets";
const PUBLIC_BUCKET = "designs";

// ---------------------------------------------------------------------------
// Fetch target assets
// ---------------------------------------------------------------------------
console.log(`\nFetching designs #${FROM}–#${TO}…`);
const { data: assets, error: fetchErr } = await supabase
  .from("assets")
  .select("id, design_number, god, file_path, status")
  .gte("design_number", FROM)
  .lte("design_number", TO)
  .order("design_number");

if (fetchErr) { console.error("Fetch error:", fetchErr.message); process.exit(1); }
if (!assets?.length) { console.log("No assets found in that range."); process.exit(0); }

console.log(`Found ${assets.length} asset(s). ${DRY ? "[DRY RUN — no changes]" : ""}\n`);

// ---------------------------------------------------------------------------
// Process each
// ---------------------------------------------------------------------------
let ok = 0, skipped = 0, failed = 0;

for (const asset of assets) {
  const label = `#${asset.design_number} (${asset.god ?? "?"})`;

  if (!asset.file_path && asset.status === "not_started") {
    console.log(`  ${label}: already not_started with no file — skip`);
    skipped++;
    continue;
  }

  if (asset.status === "approved" || asset.status === "gelato_done") {
    // Extra safety: warn before touching live/approved designs
    console.warn(`  ${label}: ⚠ status is '${asset.status}' — skipping (pass --include-approved to force)`);
    if (!args.includes("--include-approved")) { skipped++; continue; }
  }

  if (DRY) {
    console.log(`  ${label}: would delete '${asset.file_path ?? "(none)"}' and reset to not_started`);
    ok++;
    continue;
  }

  // 1. Delete private bucket file
  if (asset.file_path) {
    const { error: rmErr } = await supabase.storage
      .from(DESIGN_BUCKET)
      .remove([asset.file_path]);
    if (rmErr) {
      console.error(`  ${label}: ✗ bucket delete failed: ${rmErr.message}`);
      failed++;
      continue;
    }

    // 2. Delete public copy (Gelato bucket) if it exists
    const publicPath = asset.file_path.replace(/^designs\//, "");
    await supabase.storage.from(PUBLIC_BUCKET).remove([publicPath]);
    // Ignore errors — public copy may not exist
  }

  // 3. Reset DB row
  const { error: updateErr } = await supabase
    .from("assets")
    .update({
      status: "not_started",
      file_url: null,
      file_path: null,
      file_type: null,
      resolution_width: null,
      resolution_height: null,
      mockup_male_url: null,
      mockup_female_url: null,
      mockup_reviewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", asset.id);

  if (updateErr) {
    console.error(`  ${label}: ✗ DB reset failed: ${updateErr.message}`);
    failed++;
  } else {
    console.log(`  ${label}: ✓ reset`);
    ok++;
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nDone. ${ok} reset, ${skipped} skipped, ${failed} failed.`);
if (DRY) console.log("(dry run — rerun without --dry-run to apply)");
if (ok > 0 && !DRY) console.log("\nKajol will pick these up on her next run.");
