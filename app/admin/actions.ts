"use server";

import { refresh } from "next/cache";
import { hasAdminCookie } from "@/lib/admin-auth";
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
    .select("id, project_id, status")
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

  if (asset.status === "not_started") {
    const { error: statusError } = await supabase
      .from("assets")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", assetId);
    if (statusError) {
      return { ok: false, error: statusError.message };
    }
  }

  refresh();
  return { ok: true };
}
