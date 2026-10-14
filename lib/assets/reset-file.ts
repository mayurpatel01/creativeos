import { DESIGN_BUCKET } from "../design-storage";
import { getSupabaseAdmin } from "../supabase";

export type ResetResult = { ok: true } | { ok: false; error: string; status: number };

// Deletes a design's stored image and sends it back to not_started so Kajol
// regenerates it (Kajol never overwrites an existing file). Used by Regenerate
// and Reject. Works for any design that has a file or is dalle_done.
export async function resetDesignFile(
  assetId: string,
  options: { rejectionNote?: string | null } = {},
): Promise<ResetResult> {
  const supabase = getSupabaseAdmin();

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("status, file_path")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) return { ok: false, error: assetError.message, status: 500 };
  if (!asset) return { ok: false, error: "Asset not found.", status: 404 };
  if (!asset.file_path && asset.status !== "dalle_done") {
    return { ok: false, error: `This design has no image to reset (status ${asset.status}).`, status: 409 };
  }

  if (asset.file_path) {
    const { error: removeError } = await supabase.storage.from(DESIGN_BUCKET).remove([asset.file_path]);
    if (removeError) {
      return { ok: false, error: `Couldn't delete the image: ${removeError.message}`, status: 500 };
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("assets")
    .update({
      status: "not_started",
      file_url: null,
      file_path: null,
      file_type: null,
      resolution_width: null,
      resolution_height: null,
      // Only touch the notes when a reject supplies them.
      ...(options.rejectionNote !== undefined && { rejection_notes: options.rejectionNote }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", assetId)
    // Guard against the design moving on (e.g. sent to Gelato) mid-reset.
    .eq("status", asset.status)
    .select("id");
  if (updateError) return { ok: false, error: updateError.message, status: 500 };
  if (!updated?.length) {
    return { ok: false, error: "The design changed while resetting. Reload and try again.", status: 409 };
  }

  return { ok: true };
}
