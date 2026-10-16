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
// 2 designs × 2 images = 4 gpt-image-1 calls per run (~2 min).
// Kept small because each gpt-image-1 call takes 20-40s; 5-asset batches
// were timing out at Vercel's 5-min function limit.
const BATCH_SIZE = 2;
const MOCKUP_BUCKET = "mockups";

// Six male and six female prompt variants — each describes a visually distinct person
// (different age, complexion, expression, composition, setting) so a page of 50+ products
// shows genuine variety rather than the same face repeated.
// The agent cycles through them with i % MALE_PROMPTS.length.
const MALE_PROMPTS = [
  // M1 — young, lighter complexion, reverent, temple interior
  `A South Asian man in his mid-20s, lighter brown complexion, lean build, short neat hair,
wearing this graphic t-shirt inside an ornate Hindu temple. Warm candlelight from brass diyas
illuminates his upturned face. He gazes at the deity shrine, expression peaceful and reverent.
The t-shirt graphic is prominently visible on his chest. Bokeh temple carvings in background.
Cinematic lighting, photorealistic, 85mm portrait lens.`,

  // M2 — early 30s, medium complexion, confident, outdoor temple courtyard
  `A South Asian man in his early 30s, medium brown complexion, athletic build, slight stubble,
wearing this graphic t-shirt in an outdoor temple courtyard at golden hour. He leans casually
against an ancient stone pillar, arms crossed, confident expression, looking slightly off-camera.
Marigold garlands blur in the background. The t-shirt design is clearly visible.
Warm golden tones, photorealistic, lifestyle photography style.`,

  // M3 — late 20s, darker complexion, devotional, home puja room
  `A South Asian man in his late 20s, deeper brown complexion, relaxed posture, curly hair,
wearing this graphic t-shirt while seated cross-legged in front of a home puja room. He holds
folded hands in prayer, eyes closed, face serene. Incense smoke curls upward beside brass idols.
The t-shirt is fully visible. Soft window light, photorealistic, intimate home setting.`,

  // M4 — 40s, salt-and-pepper beard, wise expression, river ghats at dawn
  `A South Asian man in his early 40s, medium-dark complexion, close-cropped salt-and-pepper beard,
broad shoulders, wearing this graphic t-shirt standing at a river ghat at dawn. Soft pink sky
reflects on the water behind him. He looks directly at the camera with a calm, grounded expression.
The t-shirt design is fully visible. Warm dawn light, photorealistic, wide-angle lifestyle shot.`,

  // M5 — college-age, cheerful laugh, rooftop Diwali
  `A South Asian man in his early 20s, lighter-medium complexion, slim build, big open smile and
laughing expression, wearing this graphic t-shirt on a rooftop decorated for Diwali. String lights
glow warmly around him. He holds a sparkler at arm's length, looking at it joyfully.
The t-shirt graphic is clearly visible on his chest. Night setting, warm bokeh, photorealistic.`,

  // M6 — late 30s, stocky build, relaxed outdoors, temple festival grounds
  `A South Asian man in his late 30s, darker brown complexion, stocky build, neat short beard,
wearing this graphic t-shirt while walking through a vibrant Hindu festival ground. He glances
over his shoulder at the camera with an easy, relaxed smile. Colorful fabric stalls and lanterns
blur behind him. The t-shirt design is prominently visible. Natural daylight, photorealistic,
candid street-photography style.`,
];

const FEMALE_PROMPTS = [
  // F1 — mid-20s, lighter complexion, laughing, Diwali sparklers
  `A South Asian woman in her mid-20s, lighter brown complexion, long straight dark hair,
wearing this graphic t-shirt while holding sparklers during Diwali. She is laughing freely,
surrounded by warm bokeh lights. Gold jhumkas and slim bangles complement the casual tee.
The t-shirt design is clearly visible. Night time, warm festive glow, photorealistic, lifestyle portrait.`,

  // F2 — late 20s, medium complexion, focused and smiling, rangoli
  `A South Asian woman in her late 20s, medium brown complexion, hair pulled back in a loose bun,
wearing this graphic t-shirt while crouching near a large vibrant rangoli. She places flower petals
carefully, smiling at her work. The t-shirt is prominently visible as she leans forward.
Soft natural daylight, reds and yellows of the rangoli in frame. Photorealistic, warm tones.`,

  // F3 — early 30s, darker complexion, confident, cultural festival
  `A South Asian woman in her early 30s, deeper brown complexion, wavy shoulder-length hair,
wearing this graphic t-shirt at a Hindu cultural festival. She faces the camera with a warm,
confident smile, one hand resting on her hip. Colorful fabric and lanterns blur behind her.
The t-shirt design is fully visible. Daytime natural light, photorealistic, street portrait style.`,

  // F4 — 40s, graceful, temple courtyard, soft expression
  `A South Asian woman in her early 40s, medium complexion, silver-streaked hair worn loose,
wearing this graphic t-shirt in a sunlit temple courtyard. She stands beside a flowering jasmine
arch, looking slightly off-camera with a serene, graceful expression. The t-shirt design is clearly
visible. Warm afternoon light, photorealistic, editorial lifestyle photography.`,

  // F5 — college-age, playful, rooftop during Holi
  `A South Asian woman in her early 20s, lighter-medium complexion, curly hair with traces of
pink Holi powder, wearing this graphic t-shirt on a rooftop during Holi celebrations. She grins
mischievously at the camera, hands dusted with color. The t-shirt design remains clearly readable
on her chest. Bright daytime sky behind her, photorealistic, candid festival photography.`,

  // F6 — late 20s, slim, thoughtful, puja candles
  `A South Asian woman in her late 20s, darker complexion, long braided hair, slim build,
wearing this graphic t-shirt while lighting a row of clay diyas at dusk. She focuses on the flame,
expression peaceful and contemplative, profile half-turned toward the camera. The t-shirt design is
visible. Warm diya glow, dark dusk background, photorealistic, cinematic lighting.`,
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
      const variant = i % MALE_PROMPTS.length;
      const label = `${asset.god?.toLowerCase() ?? "design"}-${asset.design_number ?? asset.id.slice(0, 8)}`;

      try {
        const designBuffer = await signedDesignBuffer(asset.file_url!, supabaseUrl);
        const updates: Record<string, string> = {};

        // Male mockup
        if (!asset.mockup_male_url) {
          console.log(`[${AGENT}] Male M${variant + 1}: #${asset.design_number}`);
          const imageFile = await toFile(Readable.from(designBuffer), "design.png", { type: "image/png" });
          const maleRes = await (openai.images.edit({
            model: "gpt-image-1",
            image: imageFile,
            prompt: MALE_PROMPTS[variant] +
              "\n\nIMPORTANT: The t-shirt graphic must remain exactly as provided — legible, on-chest, not distorted.",
            size: "1024x1024",
            n: 1,
          } as Parameters<typeof openai.images.edit>[0]) as Promise<OpenAI.ImagesResponse>);
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
          const femaleRes = await (openai.images.edit({
            model: "gpt-image-1",
            image: imageFile2,
            prompt: FEMALE_PROMPTS[variant] +
              "\n\nIMPORTANT: The t-shirt graphic must remain exactly as provided — legible, on-chest, not distorted.",
            size: "1024x1024",
            n: 1,
          } as Parameters<typeof openai.images.edit>[0]) as Promise<OpenAI.ImagesResponse>);
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
