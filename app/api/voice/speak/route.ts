import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { hasAdminCookie } from "@/lib/admin-auth";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!(await hasAdminCookie())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  const { text } = await request.json() as { text?: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  // Clamp to 4096 chars — OpenAI TTS hard limit
  const truncated = text.slice(0, 4096);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",     // warm, clear female voice — good match for Rani
      input: truncated,
      speed: 1.05,       // slightly faster than default, feels natural
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[voice/speak]", err);
    const msg = err instanceof Error ? err.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
