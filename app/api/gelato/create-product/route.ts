import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { createProduct, GelatoError, productUrlFrom } from "@/lib/gelato/client";
import { publishDesignImage } from "@/lib/gelato/public-image";
import { getSupabaseAdmin } from "@/lib/supabase";

export type CreateProductResponse =
  | { success: true; gelatoProductId: string; productUrl: string | null }
  | { success: false; error: string; gelatoProductId?: string };

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const key = request.headers.get("x-admin-key") ?? request.headers.get("admin_key");
  return isValidAdminKey(key) || (await hasAdminCookie());
}

function fail(error: string, status: number, extra: { gelatoProductId?: string } = {}) {
  return NextResponse.json<CreateProductResponse>({ success: false, error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return fail("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const assetId = typeof body?.assetId === "string" ? body.assetId : null;
  if (!assetId) return fail("Body must be { assetId: string }", 400);

  const supabase = getSupabaseAdmin();

  const { data: asset, error: assetError } = await supabase
    .from("assets")
    .select("id, design_number, name, suggested_filename, status, file_path, tags, gelato_product_id, gelato_status")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) {
    // Most likely the Gelato migration hasn't been run yet.
    console.error("[gelato] asset lookup failed:", assetError);
    return fail(`Asset lookup failed: ${assetError.message}`, 500);
  }
  if (!asset) return fail("Asset not found.", 404);
  if (asset.gelato_product_id) {
    return fail("This design already has a Gelato product.", 409, { gelatoProductId: asset.gelato_product_id });
  }
  if (asset.status !== "dalle_done") {
    return fail(`Only dalle_done designs can be sent to Gelato (this one is ${asset.status}).`, 409);
  }
  if (!asset.file_path) return fail("This design has no image file.", 409);

  // Claim the asset first so a double click or a parallel bulk run can't create
  // two Gelato products for it. A previous failure ('error') can be retried.
  const { data: claimed, error: claimError } = await supabase
    .from("assets")
    .update({ gelato_status: "pending" })
    .eq("id", asset.id)
    .is("gelato_product_id", null)
    .or("gelato_status.is.null,gelato_status.eq.error")
    .select("id");
  if (claimError) return fail(`Couldn't reserve the design: ${claimError.message}`, 500);
  if (!claimed?.length) return fail("This design is already being sent to Gelato.", 409);

  const markError = () =>
    supabase.from("assets").update({ gelato_status: "error" }).eq("id", asset.id).is("gelato_product_id", null);

  // Gelato needs a plain public URL: products created from signed URLs (with a
  // ?token= query string) came back with no variants or images.
  let imageUrl: string;
  try {
    imageUrl = await publishDesignImage(asset.file_path);
  } catch (err) {
    await markError();
    return fail(err instanceof Error ? err.message : "Couldn't publish the design image.", 500);
  }

  let product;
  try {
    product = await createProduct({
      title: asset.name ?? asset.suggested_filename,
      description: `Design #${asset.design_number ?? "?"}: ${asset.name ?? asset.suggested_filename}`,
      imageUrl,
      tags: Array.isArray(asset.tags) ? asset.tags : [],
    });
  } catch (err) {
    await markError();
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[gelato] create product failed for #${asset.design_number}:`, err instanceof GelatoError ? err.details ?? message : err);
    return fail(message, err instanceof GelatoError && err.status && err.status < 500 ? 422 : 502);
  }

  const productUrl = productUrlFrom(product);
  const { error: updateError } = await supabase
    .from("assets")
    .update({
      status: "gelato_pending",
      gelato_product_id: product.id,
      gelato_product_url: productUrl,
      gelato_status: "pending",
      gelato_created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", asset.id);

  if (updateError) {
    // The Gelato product exists; report its ID so it isn't lost.
    console.error(`[gelato] product ${product.id} created but asset #${asset.design_number} not updated:`, updateError);
    return fail(`Gelato product created but saving it failed: ${updateError.message}`, 500, {
      gelatoProductId: product.id,
    });
  }

  return NextResponse.json<CreateProductResponse>({ success: true, gelatoProductId: product.id, productUrl });
}
