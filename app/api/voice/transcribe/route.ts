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

  const formData = await request.formData();
  const audio = formData.get("audio") as File | null;

  if (!audio) {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }

  // Sanity check size: Whisper limit is 25MB
  if (audio.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Audio file too large (max 25MB)" }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: "whisper-1",
      language: "en",
    });

    return NextResponse.json({ text: transcription.text });
  } catch (err) {
    console.error("[voice/transcribe]", err);
    const msg = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
