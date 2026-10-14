import OpenAI from "openai";
import { DESIGN_BUCKET, designObjectUrl, designStoragePath } from "../design-storage";
import { getSupabaseAdmin } from "../supabase";

// Kajol: generates artwork for not-started Hindu Tees designs from their dalle_prompt.

const AGENT = "Kajol";
const PROJECT_SLUG = "hindu-tees";
const BATCH_SIZE = 10;

// dall-e-3 was retired on 2026-05-12; gpt-image-2 is its replacement here.
const IMAGE_MODEL = "gpt-image-2";
const IMAGE_SIZE = "1024x1024";
const IMAGE_QUALITY = "medium"; // GPT image models have no "standard"; medium is the closest.
// Transparent backgrounds are in preview for gpt-image-2. Switch to "auto" if requests fail.
const IMAGE_BACKGROUND = "transparent";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type KajolSummary = {
  generated: number;
  failed: number;
  errors: string[];
};

export class KajolBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

function log(message: string, ...details: unknown[]) {
  console.log(`[${AGENT}] ${message}`, ...details);
}

function logError(message: string, ...details: unknown[]) {
  console.error(`[${AGENT}] ${message}`, ...details);
}

let openai: OpenAI | undefined;

function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

type PendingAsset = {
  id: string;
  design_number: number | null;
  god: string;
  suggested_filename: string;
  dalle_prompt: string;
};

async function generateImage(prompt: string): Promise<Buffer> {
  const response = await getOpenAI().images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: IMAGE_SIZE,
    quality: IMAGE_QUALITY,
    background: IMAGE_BACKGROUND,
    output_format: "png",
    n: 1,
  });

  const image = response.data?.[0];
  if (image?.b64_json) {
    return Buffer.from(image.b64_json, "base64");
  }

  // GPT image models return base64; older models returned a temporary URL instead.
  if (image?.url) {
    const download = await fetch(image.url);
    if (!download.ok) {
      throw new Error(`Image download failed with HTTP ${download.status}`);
    }
    return Buffer.from(await download.arrayBuffer());
  }

  throw new Error("OpenAI returned no image data");
}

async function processAsset(asset: PendingAsset): Promise<void> {
  const supabase = getSupabaseAdmin();
  const label = `#${asset.design_number ?? "?"} ${asset.suggested_filename}`;
  const filePath = designStoragePath(asset.god, asset.suggested_filename);

  log(`${label}: generating image with ${IMAGE_MODEL}`);
  const started = Date.now();
  const png = await generateImage(asset.dalle_prompt);
  log(`${label}: received ${(png.length / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Generated file is not a PNG");
  }

  log(`${label}: uploading to ${DESIGN_BUCKET}/${filePath}`);
  // upsert: false so Kajol never overwrites a file a designer has already uploaded.
  const { error: uploadError } = await supabase.storage
    .from(DESIGN_BUCKET)
    .upload(filePath, png, { contentType: "image/png", upsert: false });
  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  log(`${label}: marking dalle_done`);
  const { data: updated, error: updateError } = await supabase
    .from("assets")
    .update({
      status: "dalle_done",
      file_url: designObjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, filePath),
      file_path: filePath,
      file_type: "image/png",
      resolution_width: 1024,
      resolution_height: 1024,
      updated_at: new Date().toISOString(),
    })
    .eq("id", asset.id)
    .eq("status", "not_started")
    .select("id");

  if (updateError || !updated?.length) {
    // Remove the orphaned file so the next run can retry this asset cleanly.
    await supabase.storage.from(DESIGN_BUCKET).remove([filePath]);
    throw new Error(
      updateError
        ? `Database update failed: ${updateError.message}`
        : "Asset was no longer not_started; upload rolled back",
    );
  }

  log(`${label}: done`);
}

let running = false;

export async function runKajol(): Promise<KajolSummary> {
  // Guards against overlapping runs in this server process, which would pay to
  // generate the same assets twice.
  if (running) throw new KajolBusyError();
  running = true;

  const summary: KajolSummary = { generated: 0, failed: 0, errors: [] };

  try {
    const supabase = getSupabaseAdmin();
    getOpenAI();

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("slug", PROJECT_SLUG)
      .single();
    if (projectError || !project) {
      throw new Error(`Project '${PROJECT_SLUG}' not found: ${projectError?.message}`);
    }

    // Skip assets that already have a file (e.g. a designer uploaded one).
    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id, design_number, god, suggested_filename, dalle_prompt")
      .eq("project_id", project.id)
      .eq("status", "not_started")
      .is("file_path", null)
      .not("god", "is", null)
      .not("suggested_filename", "is", null)
      .not("dalle_prompt", "is", null)
      .order("design_number")
      .limit(BATCH_SIZE);
    if (assetsError) throw new Error(`Asset query failed: ${assetsError.message}`);

    log(`starting run: ${assets.length} asset(s) to generate`);

    // One at a time to stay within OpenAI rate limits.
    for (const asset of assets as PendingAsset[]) {
      try {
        await processAsset(asset);
        summary.generated++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`${asset.suggested_filename}: failed: ${message}`);
        summary.failed++;
        summary.errors.push(`${asset.suggested_filename}: ${message}`);
      }
    }

    log(`run complete: ${summary.generated} generated, ${summary.failed} failed`);
    return summary;
  } finally {
    running = false;
  }
}
