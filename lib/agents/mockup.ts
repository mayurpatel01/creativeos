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
// 5 designs × 2 parallel images = 10 gpt-image-1 calls per run.
// Male + female are now generated in parallel per asset (~25-35s each pair),
// so 5 assets ≈ 5 × 35s sequential asset pairs = ~175s + overhead, safely
// within Vercel's 300s maxDuration.
const BATCH_SIZE = 5;
const MOCKUP_BUCKET = "mockups";

// Shared instruction appended to every full-front prompt.
// "naturally sized" stops gpt-image-1 from enlarging the print unrealistically.
const FULL_PRINT_NOTE =
  "\n\nIMPORTANT: The t-shirt graphic must remain exactly as provided — " +
  "printed at a natural, realistic size on the front of the shirt (not enlarged or distorted), " +
  "clearly legible but proportional to how a real screen-printed tee looks when worn.";

// Appended to every chest/left-breast prompt.
const CHEST_PRINT_NOTE =
  "\n\nIMPORTANT: The graphic appears as a small left-chest print — " +
  "approximately 3–4 inches wide, positioned over the left breast pocket area, " +
  "exactly as provided, not distorted. It should look like a real embroidered or " +
  "small-print logo tee, not a large front graphic.";

// Six male and six female prompt variants for FULL-FRONT designs.
// Each describes a visually distinct person so a page of 50+ products shows variety.
// The agent cycles through them with i % MALE_PROMPTS.length.
const MALE_PROMPTS = [
  // M1 — young, lighter complexion, reverent, temple interior
  `A South Asian man in his mid-20s, lighter brown complexion, lean build, short neat hair,
wearing this graphic t-shirt inside an ornate Hindu temple. Warm candlelight from brass diyas
illuminates his upturned face. He gazes at the deity shrine, expression peaceful and reverent.
Bokeh temple carvings in background. Cinematic lighting, photorealistic, 85mm portrait lens.`,

  // M2 — early 30s, medium complexion, confident, outdoor temple courtyard
  `A South Asian man in his early 30s, medium brown complexion, athletic build, slight stubble,
wearing this graphic t-shirt in an outdoor temple courtyard at golden hour. He leans casually
against an ancient stone pillar, arms crossed, confident expression, looking slightly off-camera.
Marigold garlands blur in the background. Warm golden tones, photorealistic, lifestyle photography style.`,

  // M3 — late 20s, darker complexion, devotional, home puja room
  `A South Asian man in his late 20s, deeper brown complexion, relaxed posture, curly hair,
wearing this graphic t-shirt while seated cross-legged in front of a home puja room. He holds
folded hands in prayer, eyes closed, face serene. Incense smoke curls upward beside brass idols.
Soft window light, photorealistic, intimate home setting.`,

  // M4 — 40s, salt-and-pepper beard, wise expression, river ghats at dawn
  `A South Asian man in his early 40s, medium-dark complexion, close-cropped salt-and-pepper beard,
broad shoulders, wearing this graphic t-shirt standing at a river ghat at dawn. Soft pink sky
reflects on the water behind him. He looks directly at the camera with a calm, grounded expression.
Warm dawn light, photorealistic, wide-angle lifestyle shot.`,

  // M5 — college-age, cheerful laugh, rooftop Diwali
  `A South Asian man in his early 20s, lighter-medium complexion, slim build, big open smile and
laughing expression, wearing this graphic t-shirt on a rooftop decorated for Diwali. String lights
glow warmly around him. He holds a sparkler at arm's length, looking at it joyfully.
Night setting, warm bokeh, photorealistic.`,

  // M6 — late 30s, stocky build, relaxed outdoors, temple festival grounds
  `A South Asian man in his late 30s, darker brown complexion, stocky build, neat short beard,
wearing this graphic t-shirt while walking through a vibrant Hindu festival ground. He glances
over his shoulder at the camera with an easy, relaxed smile. Colorful fabric stalls and lanterns
blur behind him. Natural daylight, photorealistic, candid street-photography style.`,
];

const FEMALE_PROMPTS = [
  // F1 — mid-20s, lighter complexion, laughing, Diwali sparklers
  `A South Asian woman in her mid-20s, lighter brown complexion, long straight dark hair,
wearing this graphic t-shirt while holding sparklers during Diwali. She is laughing freely,
surrounded by warm bokeh lights. Gold jhumkas and slim bangles complement the casual tee.
Night time, warm festive glow, photorealistic, lifestyle portrait.`,

  // F2 — late 20s, medium complexion, focused and smiling, rangoli
  `A South Asian woman in her late 20s, medium brown complexion, hair pulled back in a loose bun,
wearing this graphic t-shirt while crouching near a large vibrant rangoli. She places flower petals
carefully, smiling at her work. Soft natural daylight, reds and yellows of the rangoli in frame.
Photorealistic, warm tones.`,

  // F3 — early 30s, darker complexion, confident, cultural festival
  `A South Asian woman in her early 30s, deeper brown complexion, wavy shoulder-length hair,
wearing this graphic t-shirt at a Hindu cultural festival. She faces the camera with a warm,
confident smile, one hand resting on her hip. Colorful fabric and lanterns blur behind her.
Daytime natural light, photorealistic, street portrait style.`,

  // F4 — 40s, graceful, temple courtyard, soft expression
  `A South Asian woman in her early 40s, medium complexion, silver-streaked hair worn loose,
wearing this graphic t-shirt in a sunlit temple courtyard. She stands beside a flowering jasmine
arch, looking slightly off-camera with a serene, graceful expression.
Warm afternoon light, photorealistic, editorial lifestyle photography.`,

  // F5 — college-age, playful, rooftop during Holi
  `A South Asian woman in her early 20s, lighter-medium complexion, curly hair with traces of
pink Holi powder, wearing this graphic t-shirt on a rooftop during Holi celebrations. She grins
mischievously at the camera, hands dusted with color.
Bright daytime sky behind her, photorealistic, candid festival photography.`,

  // F6 — late 20s, slim, thoughtful, puja candles
  `A South Asian woman in her late 20s, darker complexion, long braided hair, slim build,
wearing this graphic t-shirt while lighting a row of clay diyas at dusk. She focuses on the flame,
expression peaceful and contemplative, profile half-turned toward the camera.
Warm diya glow, dark dusk background, photorealistic, cinematic lighting.`,
];

// Chest-print variants — same people, different instruction.
// The graphic is a small left-chest logo, not a large front design.
const MALE_CHEST_PROMPTS = MALE_PROMPTS; // reuse same scene variety
const FEMALE_CHEST_PROMPTS = FEMALE_PROMPTS;

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
      .select("id, design_number, god, size_variant, file_url, mockup_male_url, mockup_female_url")
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
      const isChest = asset.size_variant === "CHEST";
      const malePrompts = isChest ? MALE_CHEST_PROMPTS : MALE_PROMPTS;
      const femalePrompts = isChest ? FEMALE_CHEST_PROMPTS : FEMALE_PROMPTS;
      const printNote = isChest ? CHEST_PRINT_NOTE : FULL_PRINT_NOTE;
      const label = `${asset.god?.toLowerCase() ?? "design"}-${asset.design_number ?? asset.id.slice(0, 8)}`;

      try {
        const designBuffer = await signedDesignBuffer(asset.file_url!, supabaseUrl);
        const updates: Record<string, string> = {};

        // Generate male + female in parallel — both use the same design buffer
        // but independent toFile() instances (stream can only be consumed once).
        const needsMale = !asset.mockup_male_url;
        const needsFemale = !asset.mockup_female_url;

        console.log(
          `[${AGENT}] Generating (parallel) M${variant + 1}/F${variant + 1}: #${asset.design_number}`,
        );

        const [maleResult, femaleResult] = await Promise.all([
          needsMale
            ? (async () => {
                const imageFile = await toFile(Readable.from(designBuffer), "design.png", { type: "image/png" });
                const res = await (openai.images.edit({
                  model: "gpt-image-1",
                  image: imageFile,
                  prompt: malePrompts[variant] + printNote,
                  size: "1024x1024",
                  n: 1,
                } as Parameters<typeof openai.images.edit>[0]) as Promise<OpenAI.ImagesResponse>);
                const b64 = res.data?.[0]?.b64_json;
                if (!b64) throw new Error("No b64_json in gpt-image-1 male response");
                return Buffer.from(b64, "base64");
              })()
            : Promise.resolve(null),
          needsFemale
            ? (async () => {
                const imageFile = await toFile(Readable.from(Buffer.from(designBuffer)), "design.png", { type: "image/png" });
                const res = await (openai.images.edit({
                  model: "gpt-image-1",
                  image: imageFile,
                  prompt: femalePrompts[variant] + printNote,
                  size: "1024x1024",
                  n: 1,
                } as Parameters<typeof openai.images.edit>[0]) as Promise<OpenAI.ImagesResponse>);
                const b64 = res.data?.[0]?.b64_json;
                if (!b64) throw new Error("No b64_json in gpt-image-1 female response");
                return Buffer.from(b64, "base64");
              })()
            : Promise.resolve(null),
        ]);

        if (maleResult) {
          updates.mockup_male_url = await uploadMockup(supabaseUrl, maleResult, `${label}-male-m${variant + 1}-${Date.now()}.png`);
          result.generated++;
          console.log(`[${AGENT}] ✓ Male: #${asset.design_number}`);
        }
        if (femaleResult) {
          updates.mockup_female_url = await uploadMockup(supabaseUrl, femaleResult, `${label}-female-f${variant + 1}-${Date.now()}.png`);
          result.generated++;
          console.log(`[${AGENT}] ✓ Female: #${asset.design_number}`);
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
