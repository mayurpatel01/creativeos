"use server";

import { refresh } from "next/cache";
import { hasAdminCookie } from "@/lib/admin-auth";
import { resetDesignFile } from "@/lib/assets/reset-file";
import { DESIGN_BUCKET } from "@/lib/design-storage";
import { getSupabaseAdmin } from "@/lib/supabase";

export type AssignResult = { ok: true } | { ok: false; error: string };

export async function assignAssetToDesigner(
  assetId: string,
  designerId: string,
): Promise<AssignResult> {
  // Server Actions are public endpoints, so re-check auth here.
  if (!(await hasAdminCookie())) {
    return { ok: false, error: "Your admin session has expired. Sign in again." };
  }

  const supabase = getSupabaseAdmin();

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id, project_id")
    .eq("id", assetId)
    .single();
  if (assetError || !asset) {
    return { ok: false, error: "Asset not found." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("assignments")
    .select("id")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return { ok: false, error: existingError.message };
  }

  // Reassigning moves the existing assignment to the new designer rather than stacking rows.
  const { error: assignError } = existing
    ? await supabase
        .from("assignments")
        .update({ designer_id: designerId, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase.from("assignments").insert({
        asset_id: assetId,
        designer_id: designerId,
        project_id: asset.project_id,
      });
  if (assignError) {
    return { ok: false, error: assignError.message };
  }

  // Assigning doesn't change the asset's status; it stays where it was.
  refresh();
  return { ok: true };
}

export async function unassignDesigner(assetId: string): Promise<AssignResult> {
  if (!(await hasAdminCookie())) {
    return { ok: false, error: "Your admin session has expired. Sign in again." };
  }

  const { error } = await getSupabaseAdmin()
    .from("assignments")
    .delete()
    .eq("asset_id", assetId);
  if (error) {
    return { ok: false, error: error.message };
  }

  refresh();
  return { ok: true };
}

export async function approveDesign(assetId: string): Promise<AssignResult> {
  if (!(await hasAdminCookie())) {
    return { ok: false, error: "Your admin session has expired. Sign in again." };
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error: assetError } = await supabase
    .from("assets")
    .update({
      status: "approved",
      approved: true,
      approved_at: now,
      approved_by: "admin",
      updated_at: now,
    })
    .eq("id", assetId);
  if (assetError) {
    return { ok: false, error: assetError.message };
  }

  const { error: assignmentError } = await supabase
    .from("assignments")
    .update({ status: "approved", approved_at: now, updated_at: now })
    .eq("asset_id", assetId);
  if (assignmentError) {
    return { ok: false, error: assignmentError.message };
  }

  refresh();
  return { ok: true };
}

const SIGNED_URL_SECONDS = 60 * 60;

export type SignedUrlsResult =
  | { ok: true; urls: Record<string, string | null>; expiresAt: number }
  | { ok: false; error: string };

// Batch form, so a screenful of thumbnails is one round trip. Paths outside the
// designs folder are refused even for admins.
export async function getSignedImageUrls(filePaths: string[]): Promise<SignedUrlsResult> {
  if (!(await hasAdminCookie())) {
    return { ok: false, error: "Your admin session has expired. Sign in again." };
  }

  const paths = [...new Set(filePaths)].filter(
    (p) => typeof p === "string" && p.startsWith("designs/") && !p.includes(".."),
  );
  const urls: Record<string, string | null> = {};
  if (paths.length > 0) {
    const { data, error } = await getSupabaseAdmin()
      .storage.from(DESIGN_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error) return { ok: false, error: error.message };
    for (const item of data) {
      if (item.path) urls[item.path] = item.error ? null : item.signedUrl;
    }
  }

  return { ok: true, urls, expiresAt: Date.now() + SIGNED_URL_SECONDS * 1000 };
}

export async function getSignedImageUrl(filePath: string): Promise<string | null> {
  const result = await getSignedImageUrls([filePath]);
  return result.ok ? (result.urls[filePath] ?? null) : null;
}

// Sends a design back to Kajol: deletes its stored image and resets it to
// not_started. Allowed for any design with a file, or that is dalle_done.
export async function resetDesignForRegeneration(assetId: string): Promise<AssignResult> {
  if (!(await hasAdminCookie())) {
    return { ok: false, error: "Your admin session has expired. Sign in again." };
  }

  const result = await resetDesignFile(assetId);
  if (!result.ok) return { ok: false, error: result.error };

  refresh();
  return { ok: true };
}

// Clears mockup URLs (and reviewed_at) on an asset so Bipasha regenerates
// them. Used when the design image was updated but old mockups are still set.
export async function resetMockupsForAsset(assetId: string): Promise<AssignResult> {
  if (!(await hasAdminCookie())) {
    return { ok: false, error: "Your admin session has expired. Sign in again." };
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("assets")
    .update({
      mockup_male_url: null,
      mockup_female_url: null,
      mockup_reviewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assetId);

  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
