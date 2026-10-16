// Mockup agent: generates lifestyle mockup images for active assets.
// Uses gpt-image-1 edit mode to composite the design onto a person in a
// cultural setting — temple (male) and Diwali festival (female).
//
// Writes mockup_male_url and mockup_female_url back to assets.
// Uploads results to the 'mockups' Supabase Storage bucket (public) so
// product images are accessible without signed URLs. Raw design files
// stay in the private 'assets' bucket.

import OpenAI, { toFile } from "openai";
import { Readable } from "stream";
import { getSupabaseAdmin } from "../supabase";
import { DESIGN_BUCKET } from "../design-storage";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Bipasha";
// 5 designs × 2 images = up to 10 gpt-image-1 calls per run (~5 min max).
// maxDuration=300 keeps us within Vercel Pro's 5-minute function limit.
const BATCH_SIZE = 5;
const MOCKUP_BUCKET = "mockups";

// Three male (temple) and three female (Diwali) prompt variants.
// The agent cycles through them so consecutive products get visual variety.
const MALE_PROMPTS = [
  `A South Asian man in his late 20s wearing this graphic t-shirt stands inside an ornate Hindu temple.
Warm candlelight from rows of brass diyas illuminates his face. He looks up at the deity shrine,
expression peaceful and reverent. The t-shirt graphic is prominently visible on his chest.
Bokeh temple carvings in background. Cinematic lighting, photorealistic, 85mm portrait lens.`,

  `A South Asian man in his early 30s wearing this graphic t-shirt stands in an outdoor temple courtyard
at golden hour. Late afternoon sunlight casts long shadows across ancient stone pillars.
He leans casually against a pillar, arms crossed, confident expression.
The t-shirt design is clearly visible. Vibrant marigold garlands hang in background.
Warm golden tones, photorealistic, lifestyle photography style.`,

  `A South Asian man in his late 20s wearing this graphic t-shirt sits cross-legged on the floor
in front of a beautifully decorated home puja room. Incense smoke curls upward.
Small brass idols and fresh flower offerings visible in background.
He holds folded hands in prayer, face relaxed and present.
The t-shirt is fully visible. Soft window light, photorealistic, intimate home setting.`,
];

const FEMALE_PROMPTS = [
  `A South Asian woman in her mid-20s wearing this graphic t-shirt holds sparklers during Diwali.
She is laughing, surrounded by warm bokeh lights. She wears traditional gold jewelry —
jhumkas and bangles — contrasting with the casual tee. The t-shirt design is clearly visible.
Night time, warm festive glow, photorealistic, lifestyle portrait photography.`,

  `A South Asian woman in her late 20s wearing this graphic t-shirt crouches near a large colorful
rangoli pattern on the floor. She is adding flower petals to the design, smiling.
Natural soft daylight. The t-shirt is prominently visible as she leans forward slightly.
Vibrant reds, yellows, and oranges in the rangoli. Photorealistic, lifestyle photography, warm tones.`,

  `A South Asian woman in her early 30s wearing this graphic t-shirt stands at a Hindu cultural
festival. Colorful decorations and stalls blur in the background. She looks at the camera
with a warm, confident smile. The t-shirt design is fully visible.
Daytime, natural light, festival atmosphere. Photorealistic, street portrait style.`,
];

export class MockupBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type MockupResult = {
  generated: number;
  failed: number;
  errors: string[];
};

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// The assets bucket is private. file_url is the canonical object URL
// (no token). We extract the storage path and create a short-lived
// signed URL so the agent can download the raw design.
async function signedDesignBuffer(fileUrl: string, supabaseUrl: string): Promise<Buffer> {
  // file_url looks like: https://<project>.supabase.co/storage/v1/object/assets/designs/...
  // Extract everything after /object/assets/
  const marker = `/storage/v1/object/${DESIGN_BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) throw new Error(`Unexpected file_url format: ${fileUrl}`);
  const storagePath = decodeURIComponent(fileUrl.slice(idx + marker.length));

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(DESIGN_BUCKET)
    .createSignedUrl(storagePath, 300); // 5-min window — enough for one design
  if (error || !data?.signedUrl) {
    throw new Error(`Could not sign design URL: ${error?.message ?? "no URL returned"}`);
  }
  return downloadBuffer(data.signedUrl);
}

async function uploadMockup(
  supabaseUrl: string,
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(MOCKUP_BUCKET)
    .upload(fileName, buffer, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: { publicUrl } } = supabase.storage
    .from(MOCKUP_BUCKET)
    .getPublicUrl(data.path);
  return publicUrl;
}

export async function runMockupAgent(): Promise<MockupResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new MockupBusyError();
  const runId = await startAgentRun(AGENT);

  const result: MockupResult = { generated: 0, failed: 0, errors: [] };

  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  try {
    // Assets that are live but missing at least one mockup
    const { data: assets, error } = await supabase
      .from("assets")
      .select("id, design_number, god, file_url, mockup_male_url, mockup_female_url")
      .eq("gelato_status", "active")
      .not("file_url", "is", null)
      .or("mockup_male_url.is.null,mockup_female_url.is.null")
      .order("design_number", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Asset query failed: ${error.message}`);
    if (!assets?.length) {
      console.log(`[${AGENT}] No assets need mockups.`);
      await finishAgentRun(AGENT, runId, "completed", { generated: 0, failed: 0, errors: [] });
      return result;
    }

    console.log(`[${AGENT}] Generating mockups for ${assets.length} assets…`);

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const variant = i % 3;
      const label = `${asset.god?.toLowerCase() ?? "design"}-${asset.design_number ?? asset.id.slice(0, 8)}`;

      try {
        const designBuffer = await signedDesignBuffer(asset.file_url!, supabaseUrl);
        const updates: Record<string, string> = {};

        // Male mockup
        if (!asset.mockup_male_url) {
          console.log(`[${AGENT}] Male M${variant + 1}: #${asset.design_number}`);
          const imageFile = await toFile(Readable.from(designBuffer), "design.png", { type: "image/png" });
          const maleRes = await openai.images.edit({
            model: "gpt-image-1",
            image: imageFile,
            prompt: MALE_PROMPTS[variant] +
              "\n\nIMPORTANT: The t-shirt graphic must remain exactly as provided — legible, on-chest, not distorted.",
            size: "1024x1024",
            n: 1,
            // gpt-image-1 returns base64 by default; explicit to avoid surprises
            response_format: "b64_json",
          } as Parameters<typeof openai.images.edit>[0]);
          const maleB64 = maleRes.data?.[0]?.b64_json;
          if (!maleB64) throw new Error("No b64_json in gpt-image-1 male response");
          const maleBuf = Buffer.from(maleB64, "base64");
          updates.mockup_male_url = await uploadMockup(supabaseUrl, maleBuf, `${label}-male-m${variant + 1}-${Date.now()}.png`);
          result.generated++;
          console.log(`[${AGENT}] ✓ Male: #${asset.design_number}`);
          await new Promise(r => setTimeout(r, 500));
        }

        // Female mockup
        if (!asset.mockup_female_url) {
          console.log(`[${AGENT}] Female F${variant + 1}: #${asset.design_number}`);
          const imageFile2 = await toFile(Readable.from(designBuffer), "design.png", { type: "image/png" });
          const femaleRes = await openai.images.edit({
            model: "gpt-image-1",
            image: imageFile2,
            prompt: FEMALE_PROMPTS[variant] +
              "\n\nIMPORTANT: The t-shirt graphic must remain exactly as provided — legible, on-chest, not distorted.",
            size: "1024x1024",
            n: 1,
            response_format: "b64_json",
          } as Parameters<typeof openai.images.edit>[0]);
          const femaleB64 = femaleRes.data?.[0]?.b64_json;
          if (!femaleB64) throw new Error("No b64_json in gpt-image-1 female response");
          const femaleBuf = Buffer.from(femaleB64, "base64");
          updates.mockup_female_url = await uploadMockup(supabaseUrl, femaleBuf, `${label}-female-f${variant + 1}-${Date.now()}.png`);
          result.generated++;
          console.log(`[${AGENT}] ✓ Female: #${asset.design_number}`);
          await new Promise(r => setTimeout(r, 500));
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from("assets").update(updates).eq("id", asset.id);
        }
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`#${asset.design_number}: ${msg}`);
        console.error(`[${AGENT}] ✗ #${asset.design_number}:`, err);
      }
    }

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      generated: result.generated,
      failed: result.failed,
      errors: result.errors,
    });

    console.log(`[${AGENT}] Done: ${result.generated} mockups generated, ${result.failed} failed`);
    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      generated: result.generated,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
