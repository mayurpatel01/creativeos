/**
 * POST /api/admin/fix-backgrounds
 *
 * Re-runs Clipdrop background removal on designs that were stored with a white
 * background (e.g. because Clipdrop failed during a Kajol run). Skips designs
 * that already have transparency. No DALL-E credits consumed.
 *
 * Body: { designNumbers?: number[] }
 *   - omit designNumbers to scan ALL dalle_done assets for white backgrounds
 *   - pass specific numbers to target just those designs
 *
 * Returns: { fixed: number, skipped: number, failed: number, errors: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DESIGN_BUCKET, PUBLIC_DESIGN_BUCKET, publicDesignPath } from "@/lib/design-storage";

const CLIPDROP_REMOVE_BACKGROUND_URL = "https://clipdrop-api.co/remove-background/v1";
const CLIPDROP_TIMEOUT_MS = 120_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer) {
  return buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function pngHasAlpha(buf: Buffer) {
  const colorType = buf[25];
  return colorType === 4 || colorType === 6;
}

function pngDimensions(buf: Buffer) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function removeBackground(imageBytes: Buffer, label: string): Promise<Buffer> {
  const apiKey = process.env.CLIPDROP_API_KEY;
  if (!apiKey) throw new Error("CLIPDROP_API_KEY is not set");

  const form = new FormData();
  form.append(
    "image_file",
    new Blob([new Uint8Array(imageBytes)], { type: "image/png" }),
    "image.png",
  );

  const res = await fetch(CLIPDROP_REMOVE_BACKGROUND_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(CLIPDROP_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Clipdrop HTTP ${res.status}${body?.error ? `: ${body.error}` : ""}`);
  }

  const result = Buffer.from(await res.arrayBuffer());
  const remaining = res.headers.get("x-remaining-credits");
  if (remaining) console.log(`[fix-backgrounds] ${label}: Clipdrop credits remaining: ${remaining}`);

  // Ensure PNG output with alpha channel.
  const png = isPng(result) ? result : await sharp(result).png().toBuffer();
  if (!pngHasAlpha(png)) throw new Error("Clipdrop result has no alpha channel");

  return png;
}

export async function POST(req: NextRequest) {
  if (!(await hasAdminCookie())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { designNumbers?: number[] };
  const supabase = getSupabaseAdmin();

  // ── Find assets to fix ──────────────────────────────────────────────────
  let query = supabase
    .from("assets")
    .select("id, design_number, god, suggested_filename, file_path, status")
    .not("file_path", "is", null)
    .in("status", ["dalle_done", "gelato_pending", "gelato_done"]); // fix even live ones

  if (body.designNumbers?.length) {
    query = query.in("design_number", body.designNumbers);
  } else {
    // Safety limit when scanning everything
    query = query.order("design_number", { ascending: false }).limit(50);
  }

  const { data: assets, error: qErr } = await query;
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  if (!assets?.length) return NextResponse.json({ fixed: 0, skipped: 0, failed: 0, errors: [], message: "No assets found" });

  const result = { fixed: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const asset of assets) {
    const label = `#${asset.design_number} ${asset.suggested_filename}`;
    try {
      // ── Download current image ──────────────────────────────────────────
      const { data: fileData, error: dlErr } = await supabase.storage
        .from(DESIGN_BUCKET)
        .download(asset.file_path!);
      if (dlErr) throw new Error(`Download failed: ${dlErr.message}`);

      const bytes = Buffer.from(await fileData.arrayBuffer());
      if (!isPng(bytes)) throw new Error("Stored file is not a PNG");

      // ── Skip if already transparent ────────────────────────────────────
      if (pngHasAlpha(bytes)) {
        console.log(`[fix-backgrounds] ${label}: already has alpha, skipping`);
        result.skipped++;
        continue;
      }

      console.log(`[fix-backgrounds] ${label}: has white background — running Clipdrop`);

      // ── Remove background ───────────────────────────────────────────────
      const transparent = await removeBackground(bytes, label);
      const { width, height } = pngDimensions(transparent);

      // ── Re-upload (overwrite) ───────────────────────────────────────────
      const { error: upErr } = await supabase.storage
        .from(DESIGN_BUCKET)
        .upload(asset.file_path!, transparent, {
          contentType: "image/png",
          upsert: true,          // overwrite the white-bg version
        });
      if (upErr) throw new Error(`Re-upload failed: ${upErr.message}`);

      // ── Update resolution in DB (dimensions may differ after bg removal) ─
      await supabase.from("assets").update({
        resolution_width: width,
        resolution_height: height,
        updated_at: new Date().toISOString(),
      }).eq("id", asset.id);

      // ── If already live on Gelato, update the public bucket too ──────────
      const isGelato = asset.status === "gelato_pending" || asset.status === "gelato_done";
      if (isGelato) {
        const { error: pubErr } = await supabase.storage
          .from(PUBLIC_DESIGN_BUCKET)
          .upload(publicDesignPath(asset.file_path!), transparent, {
            contentType: "image/png",
            upsert: true,
          });
        if (pubErr) {
          console.warn(`[fix-backgrounds] ${label}: private fixed but public bucket update failed: ${pubErr.message}`);
        } else {
          console.log(`[fix-backgrounds] ${label}: also updated public/designs bucket for Gelato`);
        }
      }

      console.log(`[fix-backgrounds] ${label}: fixed ✓ (${width}x${height}${isGelato ? ", public updated" : ""})`);
      result.fixed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fix-backgrounds] ${label}: ${msg}`);
      result.errors.push(`${label}: ${msg}`);
      result.failed++;
    }
  }

  return NextResponse.json(result);
}
