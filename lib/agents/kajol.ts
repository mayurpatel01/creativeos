import OpenAI from "openai";
import { removeBackground as imglyRemoveBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import { DESIGN_BUCKET, designObjectUrl, designStoragePath } from "../design-storage";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";
import { getSupabaseAdmin } from "../supabase";

// Kajol: generates artwork for not-started Hindu Tees designs from their dalle_prompt.

const AGENT = "Kajol";
const PROJECT_SLUG = "hindu-tees";
// One design per run while generation + background removal is being tuned.
const BATCH_SIZE = 1;
const TEST_BATCH_SIZE = 1;
// How long the test-run link to the private image stays valid.
const TEST_SIGNED_URL_SECONDS = 60 * 60;

// dall-e-3 was retired on 2026-05-12; gpt-image-2 is its replacement here.
const IMAGE_MODEL = "gpt-image-2";
const IMAGE_SIZE = "1024x1024";
const IMAGE_QUALITY = "medium"; // GPT image models have no "standard"; medium is the closest.
// The API has no "white" option: opaque plus a white-background prompt gives white.
// Transparency is handled later by removing the white in post-processing.
const IMAGE_BACKGROUND = "opaque";

// Stored prompts ask for a transparent background, which contradicts an opaque
// render, so swap that phrase at generation time. The database is left as is.
function withWhiteBackground(prompt: string): string {
  const swapped = prompt.replace(/transparent background/gi, "plain solid white background");
  return swapped === prompt ? `${prompt} Plain solid white background.` : swapped;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type KajolSummary = {
  generated: number;
  failed: number;
  errors: string[];
  // Images kept on white because background removal failed.
  backgroundRemovalFailed: number;
  test?: boolean;
};

export type KajolImage = {
  designNumber: number | null;
  filename: string;
  filePath: string;
  fileUrl: string;
  // Test runs only: a temporary link that opens the image (the bucket is private).
  signedUrl?: string;
};

export type KajolResult = KajolSummary & { images: KajolImage[] };

export class KajolBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type KajolLogLine = { level: "info" | "error"; message: string; at: string };

// Set for the duration of a run so callers can stream progress. Only one run
// happens per process at a time, so a single listener is enough.
let logListener: ((line: KajolLogLine) => void) | null = null;

function log(message: string, ...details: unknown[]) {
  console.log(`[${AGENT}] ${message}`, ...details);
  logListener?.({ level: "info", message, at: new Date().toISOString() });
}

function logError(message: string, ...details: unknown[]) {
  console.error(`[${AGENT}] ${message}`, ...details);
  logListener?.({ level: "error", message, at: new Date().toISOString() });
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
    prompt: withWhiteBackground(prompt),
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

function isPng(buffer: Buffer): boolean {
  return buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

// True if the PNG can hold transparency: an RGBA or gray+alpha color type in the
// IHDR header (byte 25), or a palette with a tRNS transparency chunk.
function pngHasAlpha(buffer: Buffer): boolean {
  const colorType = buffer[25];
  return colorType === 4 || colorType === 6 || (colorType === 3 && buffer.includes("tRNS"));
}

// Width and height from the PNG IHDR header.
function pngDimensions(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Background removal runs locally with IMG.LY's model (bundled in the package,
// no API key or credits). "medium" is the library default and the better of the
// two bundled models. The first call in a server process loads the model, so
// it's slower than the rest.
const BACKGROUND_REMOVAL_MODEL = "medium";

const OPAQUE_ALPHA_THRESHOLD = 250;

type RemovalResult = { status: "removed"; png: Buffer } | { status: "failed" };

// Second pass: strip the white background. Any failure keeps the
// white-background original so the run continues.
async function removeBackground(png: Buffer, label: string): Promise<RemovalResult> {
  log(`${label}: removing background (local ${BACKGROUND_REMOVAL_MODEL} model)`);
  const started = Date.now();
  try {
    // Ask for raw RGBA pixels and encode the PNG here: the library's own PNG
    // output goes through a quality setting that reduces it to a 256-colour
    // palette, which bands the airbrush gradients.
    const blob = await imglyRemoveBackground(new Blob([new Uint8Array(png)], { type: "image/png" }), {
      model: BACKGROUND_REMOVAL_MODEL,
      output: { format: "image/x-rgba8" },
    });
    const pixels = Buffer.from(await blob.arrayBuffer());
    const before = pngDimensions(png);
    if (pixels.length !== before.width * before.height * 4) {
      throw new Error(`expected ${before.width}x${before.height} RGBA pixels, got ${pixels.length} bytes`);
    }
    // The model's mask tops out at 254, so solid areas would be very slightly
    // see-through. Snap near-opaque pixels to fully opaque for printing.
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] >= OPAQUE_ALPHA_THRESHOLD) pixels[i] = 255;
    }
    const result = await sharp(pixels, { raw: { width: before.width, height: before.height, channels: 4 } })
      .png()
      .toBuffer();
    if (!pngHasAlpha(result)) throw new Error("result has no transparency channel");
    const after = pngDimensions(result);

    log(`${label}: background removed in ${((Date.now() - started) / 1000).toFixed(1)}s (${after.width}x${after.height})`);
    return { status: "removed", png: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`${label}: background removal failed, keeping white background: ${message}`);
    return { status: "failed" };
  }
}

async function processAsset(
  asset: PendingAsset,
): Promise<{ filePath: string; fileUrl: string; backgroundRemoval: RemovalResult["status"] }> {
  const supabase = getSupabaseAdmin();
  const label = `#${asset.design_number ?? "?"} ${asset.suggested_filename}`;
  const filePath = designStoragePath(asset.god, asset.suggested_filename);

  log(`${label}: generating image with ${IMAGE_MODEL}`);
  const started = Date.now();
  const generated = await generateImage(asset.dalle_prompt);
  log(`${label}: received ${(generated.length / 1024).toFixed(0)} KB in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (!isPng(generated)) {
    throw new Error("Generated file is not a PNG");
  }

  // generate (1024) → remove background → save. A failed removal keeps the
  // white-background image.
  // TODO: re-add upscale step when we have a free/cheap upscale solution
  const removal = await removeBackground(generated, label);
  const png = removal.status === "removed" ? removal.png : generated;
  const { width, height } = pngDimensions(png);

  log(`${label}: uploading to ${DESIGN_BUCKET}/${filePath}`);
  // upsert: false so Kajol never overwrites a file a designer has already uploaded.
  const { error: uploadError } = await supabase.storage
    .from(DESIGN_BUCKET)
    .upload(filePath, png, { contentType: "image/png", upsert: false });
  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  log(`${label}: marking dalle_done`);
  const fileUrl = designObjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, filePath);
  const { data: updated, error: updateError } = await supabase
    .from("assets")
    .update({
      status: "dalle_done",
      file_url: fileUrl,
      file_path: filePath,
      file_type: "image/png",
      resolution_width: width,
      resolution_height: height,
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
  return {
    filePath,
    fileUrl,
    backgroundRemoval: removal.status,
  };
}

async function signedUrlFor(filePath: string): Promise<string | undefined> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(DESIGN_BUCKET)
    .createSignedUrl(filePath, TEST_SIGNED_URL_SECONDS);
  if (error) {
    logError(`couldn't create a viewing link for ${filePath}: ${error.message}`);
    return undefined;
  }
  return data.signedUrl;
}

let running = false;

export async function runKajol(
  options: {
    onLog?: (line: KajolLogLine) => void;
    // Generate a single image and return a viewing link, to check quality.
    test?: boolean;
  } = {},
): Promise<KajolResult> {
  // Overlapping runs would pay to generate the same assets twice. The flag covers
  // this process; agent_runs covers other server instances.
  if (running) throw new KajolBusyError();
  running = true;

  const test = options.test === true;
  const summary: KajolSummary = {
    generated: 0,
    failed: 0,
    errors: [],
    backgroundRemovalFailed: 0,
    ...(test && { test: true }),
  };
  const images: KajolImage[] = [];
  let runId: string | null = null;

  try {
    if (await hasActiveRun(AGENT)) throw new KajolBusyError();
    logListener = options.onLog ?? null;
    runId = await startAgentRun(AGENT);

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
      .limit(test ? TEST_BATCH_SIZE : BATCH_SIZE);
    if (assetsError) throw new Error(`Asset query failed: ${assetsError.message}`);

    log(`starting ${test ? "test " : ""}run: ${assets.length} asset(s) to generate`);

    // One at a time to stay within OpenAI rate limits.
    for (const asset of assets as PendingAsset[]) {
      try {
        const { filePath, fileUrl, backgroundRemoval } = await processAsset(asset);
        summary.generated++;
        if (backgroundRemoval === "failed") summary.backgroundRemovalFailed++;
        images.push({
          designNumber: asset.design_number,
          filename: asset.suggested_filename,
          filePath,
          fileUrl,
          ...(test && { signedUrl: await signedUrlFor(filePath) }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError(`${asset.suggested_filename}: failed: ${message}`);
        summary.failed++;
        summary.errors.push(`${asset.suggested_filename}: ${message}`);
      }
    }

    log(`run complete: ${summary.generated} generated, ${summary.failed} failed`);
    // Signed links expire, so agent_runs keeps only the summary.
    await finishAgentRun(AGENT, runId, "completed", summary);
    return { ...summary, images };
  } catch (err) {
    if (!(err instanceof KajolBusyError)) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`run failed: ${message}`);
      await finishAgentRun(AGENT, runId, "failed", {
        ...summary,
        errors: [...summary.errors, message],
      });
    }
    throw err;
  } finally {
    logListener = null;
    running = false;
  }
}
