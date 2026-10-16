import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { VidyaBusyError, runVidya } from "@/lib/agents/vidya";

export const maxDuration = 60;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const key = request.headers.get("x-admin-key") ?? request.headers.get("admin_key");
  return isValidAdminKey(key) || (await hasAdminCookie());
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runVidya();
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof VidyaBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[Vidya] run failed:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
