import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { GelatoError, getProduct, type GelatoStoreProduct } from "@/lib/gelato/client";
import { getSupabaseAdmin } from "@/lib/supabase";

export type SyncStatusResponse =
  | { synced: number; failed: number; stillPending: number; warning?: string }
  | { error: string };

// Gelato lookups in flight at once: quicker than one by one, gentle on the API.
const CONCURRENCY = 4;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const key = request.headers.get("x-admin-key") ?? request.headers.get("admin_key");
  return isValidAdminKey(key) || (await hasAdminCookie());
}

function fail(error: string, status: number) {
  return NextResponse.json<SyncStatusResponse>({ error }, { status });
}

// Gelato documents no list of product statuses, so a failure is recognised by
// its shape: an error or failure status, or a publishing error code.
function hasFailed(product: GelatoStoreProduct): boolean {
  return /error|fail/i.test(product.status ?? "") || Boolean(product.publishingErrorCode);
}

// Gelato builds variants and mockups in the background after create-product, so
// products start 'pending'. This checks each pending one: active products get
// gelato_status 'active' (and the asset moves to gelato_done once that status is
// allowed by the database); failed ones are marked 'error' so they show on the
// dashboard and can be retried. Anything Gelato hasn't finished (or couldn't be
// read) stays pending for the next sync.
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return fail("Unauthorized", 401);

  const supabase = getSupabaseAdmin();

  const { data: assets, error: queryError } = await supabase
    .from("assets")
    .select("id, design_number, gelato_product_id")
    .eq("gelato_status", "pending")
    .not("gelato_product_id", "is", null);
  if (queryError) {
    console.error("[gelato] sync: pending lookup failed:", queryError);
    return fail(`Couldn't read pending products: ${queryError.message}`, 500);
  }

  let synced = 0;
  let failed = 0;
  let stillPending = 0;
  // A missing API key or store ID fails every lookup the same way: report it
  // instead of counting everything as still pending.
  let configError: string | null = null;
  // A save that fails is reported, not left looking pending.
  let saveError: string | null = null;
  // Set when the gelato_done status migration hasn't been run yet.
  let gelatoDoneUnavailable = false;

  async function sync(asset: { id: string; design_number: number | null; gelato_product_id: string }) {
    let product: GelatoStoreProduct;
    try {
      product = await getProduct(asset.gelato_product_id);
    } catch (err) {
      if (err instanceof GelatoError && err.status === undefined) configError = err.message;
      console.error(`[gelato] sync: couldn't read product ${asset.gelato_product_id} (#${asset.design_number}):`, err);
      stillPending++;
      return;
    }

    const isActive = product.status?.toLowerCase() === "active";
    if (!isActive && !hasFailed(product)) {
      stillPending++;
      return;
    }

    const changes = { gelato_status: isActive ? "active" : "error" };
    if (!isActive) {
      console.warn(
        `[gelato] sync: product ${asset.gelato_product_id} (#${asset.design_number}) failed: status ${product.status ?? "—"}, code ${product.publishingErrorCode ?? "—"}`,
      );
    }

    // Only change rows that are still pending, so a concurrent change isn't overwritten.
    const { data: updated, error: updateError } = await supabase
      .from("assets")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .eq("gelato_status", "pending")
      .select("id");
    if (updateError) {
      saveError = updateError.message;
      console.error(`[gelato] sync: #${asset.design_number} not updated to ${changes.gelato_status}:`, updateError);
      stillPending++;
      return;
    }
    if (!updated?.length) return;
    if (!isActive) {
      failed++;
      return;
    }
    synced++;

    // Separate step so gelato_status is saved even before the gelato_done
    // migration (20261015120000) is run; 23514 is the status check rejecting it.
    const { error: statusError } = await supabase
      .from("assets")
      .update({ status: "gelato_done" })
      .eq("id", asset.id)
      .eq("status", "gelato_pending");
    if (statusError?.code === "23514") {
      gelatoDoneUnavailable = true;
    } else if (statusError) {
      console.error(`[gelato] sync: #${asset.design_number} active but status not moved to gelato_done:`, statusError);
    }
  }

  const queue = [...(assets ?? [])];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let asset = queue.shift(); asset; asset = queue.shift()) await sync(asset);
    }),
  );

  if (configError) return fail(configError, 500);
  if (saveError) {
    return fail(
      `${synced} active and ${failed} failed were saved, but some couldn't be: ${saveError}`,
      500,
    );
  }

  console.log(`[gelato] sync: ${synced} now active, ${failed} failed, ${stillPending} still pending`);
  return NextResponse.json<SyncStatusResponse>({
    synced,
    failed,
    stillPending,
    ...((gelatoDoneUnavailable as boolean)
      ? {
          warning:
            "Active designs keep status gelato_pending until the gelato_done migration (20261015120000) is run.",
        }
      : {}),
  });
}
