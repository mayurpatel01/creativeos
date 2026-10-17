import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { resetDesignFile } from "@/lib/assets/reset-file";

const MAX_NOTE_LENGTH = 2000;

export type RejectResponse = { success: true } | { success: false; error: string };

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const key = request.headers.get("x-admin-key") ?? request.headers.get("admin_key");
  return isValidAdminKey(key) || (await hasAdminCookie());
}

// Rejects a generated design: deletes its image and sends it back to
// not_started (with an optional note) so Kajol regenerates it.
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json<RejectResponse>({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const assetId = typeof body?.assetId === "string" ? body.assetId : null;
  if (!assetId) {
    return NextResponse.json<RejectResponse>(
      { success: false, error: "Body must be { assetId: string, note?: string }" },
      { status: 400 },
    );
  }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : "";

  const result = await resetDesignFile(assetId, { rejectionNote: note || null });
  if (!result.ok) {
    return NextResponse.json<RejectResponse>({ success: false, error: result.error }, { status: result.status });
  }
  revalidatePath("/admin");
  revalidatePath("/admin/review");
  return NextResponse.json<RejectResponse>({ success: true });
}
