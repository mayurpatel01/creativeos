import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

// Actions:
//   approve      — mark both mockups reviewed (keep URLs as-is)
//   redo_male    — clear male mockup URL so Bipasha regenerates it
//   redo_female  — clear female mockup URL so Bipasha regenerates it
//   redo_both    — clear both mockup URLs for full regeneration
export type MockupReviewAction = "approve" | "redo_male" | "redo_female" | "redo_both";

export type MockupReviewResponse =
  | { success: true }
  | { success: false; error: string };

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const key = request.headers.get("x-admin-key") ?? request.headers.get("admin_key");
  return isValidAdminKey(key) || (await hasAdminCookie());
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json<MockupReviewResponse>({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const assetId = typeof body?.assetId === "string" ? body.assetId : null;
  const action = typeof body?.action === "string" ? body.action as MockupReviewAction : null;

  if (!assetId || !action) {
    return NextResponse.json<MockupReviewResponse>(
      { success: false, error: "Body must be { assetId: string, action: 'approve' | 'redo_male' | 'redo_female' | 'redo_both' }" },
      { status: 400 },
    );
  }

  if (!["approve", "redo_male", "redo_female", "redo_both"].includes(action)) {
    return NextResponse.json<MockupReviewResponse>(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const updates: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };

  if (action === "approve") {
    // Mark reviewed; keep the existing mockup URLs
    updates.mockup_reviewed_at = new Date().toISOString();
  } else {
    // Clear the appropriate URL(s) — Bipasha will regenerate on next run.
    // Also clear reviewed_at so the asset re-enters the queue once regenerated.
    updates.mockup_reviewed_at = null;
    if (action === "redo_male" || action === "redo_both") {
      updates.mockup_male_url = null;
    }
    if (action === "redo_female" || action === "redo_both") {
      updates.mockup_female_url = null;
    }
  }

  const { error } = await supabase
    .from("assets")
    .update(updates)
    .eq("id", assetId);

  if (error) {
    return NextResponse.json<MockupReviewResponse>(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  revalidatePath("/admin");
  revalidatePath("/admin/mockups");
  return NextResponse.json<MockupReviewResponse>({ success: true });
}
