// Flags one or more qa_issues for a specific agent.
// Called from the QA UI when the user clicks "Send to Katrina" / "Send to Bipasha" etc.
// Sets flagged_for_agent = true on those issue IDs.
// The target agent reads flagged issues and prioritizes those asset_ids.

import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  if (!(await hasAdminCookie())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { issueIds } = (await request.json()) as { issueIds: string[] };
  if (!Array.isArray(issueIds) || issueIds.length === 0) {
    return NextResponse.json({ error: "issueIds required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("qa_issues")
    .update({ flagged_for_agent: true })
    .in("id", issueIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, flagged: issueIds.length });
}
