import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { MeeraBusyError, runMeera } from "@/lib/agents/meera";

export const maxDuration = 120;

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
    const summary = await runMeera();
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof MeeraBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[Meera] run failed:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
