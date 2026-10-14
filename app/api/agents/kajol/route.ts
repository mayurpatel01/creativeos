import { NextResponse, type NextRequest } from "next/server";
import { isValidAdminKey } from "@/lib/admin-auth";
import { KajolBusyError, runKajol } from "@/lib/agents/kajol";

// Up to 10 images generated one after another can take several minutes.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Prefer x-admin-key: some proxies drop headers with underscores, like admin_key.
  const key = request.headers.get("x-admin-key") ?? request.headers.get("admin_key");
  if (!isValidAdminKey(key)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runKajol();
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof KajolBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Kajol] run failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
