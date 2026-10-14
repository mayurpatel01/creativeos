import {
  DESIGN_BUCKET,
  MAX_DESIGN_BYTES,
  PUBLIC_DESIGN_BUCKET,
  publicDesignPath,
  publicDesignUrl,
} from "../design-storage";
import { getSupabaseAdmin } from "../supabase";

let bucketReady: Promise<void> | null = null;

// Creates the public bucket on first use if it doesn't exist yet.
function ensurePublicBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase.storage.getBucket(PUBLIC_DESIGN_BUCKET);
    if (data) {
      if (!data.public) {
        throw new Error(`Storage bucket "${PUBLIC_DESIGN_BUCKET}" exists but isn't public.`);
      }
      return;
    }
    const { error } = await supabase.storage.createBucket(PUBLIC_DESIGN_BUCKET, {
      public: true,
      allowedMimeTypes: ["image/png"],
      fileSizeLimit: MAX_DESIGN_BYTES,
    });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Couldn't create the "${PUBLIC_DESIGN_BUCKET}" bucket: ${error.message}`);
    }
  })();
  bucketReady.catch(() => {
    bucketReady = null;
  });
  return bucketReady;
}

// Copies a design from the private bucket into the public one and returns its
// public URL, after checking the URL actually serves the image.
export async function publishDesignImage(filePath: string): Promise<string> {
  await ensurePublicBucket();
  const supabase = getSupabaseAdmin();

  const { data: file, error: downloadError } = await supabase.storage.from(DESIGN_BUCKET).download(filePath);
  if (downloadError || !file) {
    throw new Error(`Couldn't read the design image: ${downloadError?.message ?? "not found"}`);
  }

  // upsert: a regenerated design replaces its earlier public copy.
  const { error: uploadError } = await supabase.storage
    .from(PUBLIC_DESIGN_BUCKET)
    .upload(publicDesignPath(filePath), file, { contentType: "image/png", upsert: true });
  if (uploadError) throw new Error(`Couldn't publish the design image: ${uploadError.message}`);

  const url = publicDesignUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, filePath);
  const check = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
  if (!check.ok) throw new Error(`Public image URL isn't reachable (HTTP ${check.status}).`);
  return url;
}

// Removes the public copy (e.g. when a design is rejected or regenerated).
// Missing files are fine; other errors are logged, not thrown.
export async function unpublishDesignImage(filePath: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .storage.from(PUBLIC_DESIGN_BUCKET)
    .remove([publicDesignPath(filePath)]);
  if (error && !/not found/i.test(error.message)) {
    console.error(`[designs] couldn't remove public copy of ${filePath}:`, error.message);
  }
}
