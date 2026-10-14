import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { KajolBusyError, runKajol, type KajolLogLine, type KajolResult } from "@/lib/agents/kajol";

// Up to 10 images generated one after another can take several minutes.
export const maxDuration = 300;

// ?test=1 generates a single image and includes a temporary link to view it.
// Streamed one JSON object per line when called with ?stream=1.
export type KajolStreamEvent =
  | ({ type: "log" } & KajolLogLine)
  | { type: "summary"; summary: KajolResult }
  | { type: "error"; message: string; busy?: boolean };

async function isAuthorized(request: NextRequest): Promise<boolean> {
  // Prefer x-admin-key: some proxies drop headers with underscores, like admin_key.
  const key = request.headers.get("x-admin-key") ?? request.headers.get("admin_key");
  // The agents page calls this from the browser with the admin cookie instead.
  return isValidAdminKey(key) || (await hasAdminCookie());
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const test = request.nextUrl.searchParams.get("test") === "1";

  if (request.nextUrl.searchParams.get("stream") === "1") {
    return streamRun(test);
  }

  try {
    const summary = await runKajol({ test });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof KajolBusyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[Kajol] run failed:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function streamRun(test: boolean): Response {
  const encoder = new TextEncoder();
  let open = true;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: KajolStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };

      // If the browser disconnects, the run keeps going (images in progress are
      // already paid for) and its result is still recorded in agent_runs.
      try {
        const summary = await runKajol({ test, onLog: (line) => send({ type: "log", ...line }) });
        send({ type: "summary", summary });
      } catch (err) {
        if (!(err instanceof KajolBusyError)) console.error("[Kajol] run failed:", err);
        send({ type: "error", message: errorMessage(err), busy: err instanceof KajolBusyError });
      } finally {
        if (open) controller.close();
        open = false;
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
