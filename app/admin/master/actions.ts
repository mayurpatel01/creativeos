"use server";

import { revalidatePath } from "next/cache";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { publishDesignImage } from "@/lib/gelato/public-image";
import { createProduct, GelatoError, productUrlFrom, templateForSizeVariant } from "@/lib/gelato/client";

export type FinalApproveResult = { ok: true } | { ok: false; error: string };

/**
 * Final-approve a design:
 * 1. Stamps `final_approved_at` on the asset.
 * 2. If it already has a gelato_product_id → stamps mockup_reviewed_at (records the review),
 *    and leaves the Gelato listing in place (a future updateProduct call can refresh images).
 * 3. If it doesn't have a gelato_product_id → publishes core image + creates Gelato product,
 *    then updates status to gelato_pending.
 */
export async function finalApproveAsset(assetId: string): Promise<FinalApproveResult> {
  if (!(await hasAdminCookie())) {
    return { ok: false, error: "Your admin session has expired. Sign in again." };
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // Load the asset
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle() as { data: any; error: any };
  if (assetError) return { ok: false, error: assetError.message };
  if (!asset) return { ok: false, error: "Design not found." };
  if (!asset.file_path) return { ok: false, error: "This design has no image yet." };

  // --- Path A: already on Gelato — just stamp the review times ---
  if (asset.gelato_product_id) {
    const { error: updateError } = await supabase
      .from("assets")
      .update({
        mockup_reviewed_at: now,
        final_approved_at: now,
        updated_at: now,
      })
      .eq("id", assetId);
    if (updateError) return { ok: false, error: updateError.message };
    revalidatePath("/admin/master");
    revalidatePath("/admin");
    return { ok: true };
  }

  // --- Path B: not on Gelato yet — publish image and create product ---

  // Pick template
  let template: { templateId: string; size: string };
  try {
    template = templateForSizeVariant(asset.size_variant);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Claim the slot (prevent double-publish)
  const { data: claimed, error: claimError } = await supabase
    .from("assets")
    .update({ gelato_status: "pending" })
    .eq("id", assetId)
    .is("gelato_product_id", null)
    .or("gelato_status.is.null,gelato_status.eq.error")
    .select("id");
  if (claimError) return { ok: false, error: `Couldn't reserve the design: ${claimError.message}` };
  if (!claimed?.length) return { ok: false, error: "This design is already being sent to Gelato." };

  const markError = () =>
    supabase.from("assets").update({ gelato_status: "error" }).eq("id", assetId).is("gelato_product_id", null);

  // Publish image to public bucket
  let imageUrl: string;
  try {
    imageUrl = await publishDesignImage(asset.file_path);
  } catch (err) {
    await markError();
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't publish the design image." };
  }

  // Create Gelato product
  let product;
  try {
    product = await createProduct({
      templateId: template.templateId,
      title: asset.name ?? asset.suggested_filename,
      description: `Design #${asset.design_number ?? "?"}: ${asset.name ?? asset.suggested_filename}`,
      imageUrl,
      tags: Array.isArray(asset.tags) ? asset.tags : [],
    });
  } catch (err) {
    await markError();
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[master] create product failed for #${asset.design_number}:`,
      err instanceof GelatoError ? (err as GelatoError).details ?? message : err,
    );
    return { ok: false, error: message };
  }

  const productUrl = productUrlFrom(product);

  const { error: finalizeError } = await supabase
    .from("assets")
    .update({
      status: "gelato_pending",
      gelato_product_id: product.id,
      gelato_product_url: productUrl,
      gelato_status: "pending",
      gelato_created_at: now,
      mockup_reviewed_at: now,
      final_approved_at: now,
      updated_at: now,
    })
    .eq("id", assetId);

  if (finalizeError) {
    console.error(`[master] product ${product.id} created but asset #${asset.design_number} not updated:`, finalizeError);
    return { ok: false, error: `Gelato product created (${product.id}) but saving failed: ${finalizeError.message}` };
  }

  revalidatePath("/admin/master");
  revalidatePath("/admin");
  revalidatePath("/admin/review");
  return { ok: true };
}
