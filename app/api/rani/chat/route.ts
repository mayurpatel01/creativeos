import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { hasAdminCookie } from "@/lib/admin-auth";
import { RANI_MODEL, RANI_SYSTEM_PROMPT } from "@/lib/rani/prompt";
import { formatStatusSummary, getStatusSummary } from "@/lib/rani/status";

export const maxDuration = 300;

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 50_000;

// One JSON object per line, so the browser can parse the stream incrementally.
export type RaniStreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; message: string };

type ChatMessage = { role: "user" | "assistant"; content: string };

function parseMessages(body: unknown): ChatMessage[] | string {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array";
  if (messages.length > MAX_MESSAGES) {
    return `This conversation is over ${MAX_MESSAGES} messages. Start a new chat.`;
  }

  for (const [i, m] of messages.entries()) {
    const expectedRole = i % 2 === 0 ? "user" : "assistant";
    if (m?.role !== expectedRole || typeof m.content !== "string" || !m.content.trim()) {
      return `messages[${i}] must be a non-empty ${expectedRole} message`;
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return `messages[${i}] is over ${MAX_MESSAGE_CHARS} characters`;
    }
  }
  if (messages.at(-1).role !== "user") return "the last message must be from the user";

  return messages as ChatMessage[];
}

function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic API key is invalid.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Try again shortly.";
  if (err instanceof Anthropic.BadRequestError) return `Request rejected: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Anthropic API error (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : "Unexpected error";
}

export async function POST(request: NextRequest) {
  if (!(await hasAdminCookie())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = parseMessages(await request.json().catch(() => null));
  if (typeof messages === "string") {
    return NextResponse.json({ error: messages }, { status: 400 });
  }

  // Fetched per turn so Rani always answers from current data.
  let statusContext: string;
  try {
    statusContext = formatStatusSummary(await getStatusSummary());
  } catch (err) {
    console.error("[Rani] status summary failed:", err);
    statusContext = "Live operations snapshot is unavailable right now (database query failed).";
  }

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RaniStreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        const stream = client.beta.messages.stream(
          {
            model: RANI_MODEL,
            max_tokens: 64000,
            output_config: { effort: "medium" },
            // If a safety classifier declines, the API retries on a recommended
            // fallback model within the same stream.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            cache_control: { type: "ephemeral" },
            system: [
              { type: "text", text: RANI_SYSTEM_PROMPT },
              { type: "text", text: statusContext },
            ],
            messages,
          },
          { signal: request.signal },
        );

        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "text", text: event.delta.text });
          }
        }

        const final = await stream.finalMessage();
        send({ type: "done", stopReason: final.stop_reason });
      } catch (err) {
        if (request.signal.aborted) return; // the user navigated away or stopped the response
        console.error("[Rani] chat stream failed:", err);
        send({ type: "error", message: errorMessage(err) });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
