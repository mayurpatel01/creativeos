import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { MockupBusyError, runMockupAgent } from "@/lib/agents/mockup";

// gpt-image-1 edits can take a while per image
export const maxDuration = 300;

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
    const summary = await runMockupAgent();
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof MockupBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[Mockup] run failed:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
