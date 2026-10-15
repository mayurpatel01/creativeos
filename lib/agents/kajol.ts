import OpenAI from "openai";
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

// Background removal flood-fills the white from the corners, so the
// background has to be flat white with crisp edges around the design.
const WHITE_BACKGROUND_INSTRUCTIONS =
  "solid flat white background, no shadows, no gradients behind the design, hard clean edges on all design elements";

// Stored prompts ask for a transparent background, which contradicts an opaque
// render, so swap that phrase at generation time. The database is left as is.
function withWhiteBackground(prompt: string): string {
  const swapped = prompt.replace(
    /transparent background/gi,
    `${WHITE_BACKGROUND_INSTRUCTIONS}, plain solid white background`,
  );
  return swapped === prompt ? `${prompt} ${WHITE_BACKGROUND_INSTRUCTIONS}, plain solid white background.` : swapped;
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

// Width and height from the PNG IHDR header.
function pngDimensions(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Background removal: flood-fill the white background from the image corners
// and make it transparent. Works because generation asks for a flat white
// background. Pixels count as background white when R, G and B are all above
// this; it tolerates the slightly warm off-white gpt-image-2 sometimes produces
// but stops hard at any coloured pixel.
const WHITE_THRESHOLD = 235;
// More removed than this means the fill leaked into the design.
const MAX_REMOVED_FRACTION = 0.95;

type RemovalResult = { status: "removed"; png: Buffer } | { status: "failed" };

// Clears every near-white pixel connected (4-way) to a near-white corner.
// White areas inside the design that don't touch the background are kept.
// Returns how many pixels were made transparent.
function floodFillWhite(rgba: Buffer, width: number, height: number): { removed: number; seeds: number } {
  const isWhite = (p: number) => {
    const i = p * 4;
    return rgba[i] > WHITE_THRESHOLD && rgba[i + 1] > WHITE_THRESHOLD && rgba[i + 2] > WHITE_THRESHOLD;
  };

  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const seeds = corners.filter(isWhite);
  if (seeds.length === 0) throw new Error("no corner is near-white, so there's no white background to remove");

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const seed of seeds) {
    if (!visited[seed]) {
      visited[seed] = 1;
      queue[tail++] = seed;
    }
  }

  while (head < tail) {
    const p = queue[head++];
    rgba[p * 4 + 3] = 0;
    const x = p % width;
    const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
    for (const n of neighbours) {
      if (n >= 0 && n < width * height && !visited[n] && isWhite(n)) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  return { removed: tail, seeds: seeds.length };
}

// Second pass: remove the white background. Any failure keeps the
// white-background original so the run continues.
async function removeBackground(png: Buffer, label: string): Promise<RemovalResult> {
  log(`${label}: removing white background (flood fill from corners)`);
  const started = Date.now();
  try {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { removed, seeds } = floodFillWhite(data, info.width, info.height);
    const fraction = removed / (info.width * info.height);
    if (fraction > MAX_REMOVED_FRACTION) {
      throw new Error(`fill would remove ${(fraction * 100).toFixed(1)}% of the image; it likely leaked into the design`);
    }

    const result = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
    log(
      `${label}: background removed in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
        `(${(fraction * 100).toFixed(1)}% of pixels cleared from ${seeds} corner(s))`,
    );
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
