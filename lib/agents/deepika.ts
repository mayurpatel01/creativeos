// Deepika: batch-publishes approved assets to Gelato.
// Picks assets with status='dalle_done' and no gelato_product_id, creates
// Gelato products via the existing client, and updates each asset row.
//
// Designed to run from /api/agents/deepika — one batch per trigger.

import { createProduct, GelatoError, productUrlFrom, templateForSizeVariant } from "../gelato/client";
import { publishDesignImage } from "../gelato/public-image";
import { getSupabaseAdmin } from "../supabase";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Deepika";
const BATCH_SIZE = 10;
// ms between Gelato API calls to stay under rate limits
const RATE_LIMIT_MS = 600;

export class DeepikaBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type DeepikaResult = {
  published: number;
  failed: number;
  errors: string[];
};

export async function runDeepika(): Promise<DeepikaResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new DeepikaBusyError();
  const runId = await startAgentRun(AGENT);

  const result: DeepikaResult = { published: 0, failed: 0, errors: [] };

  try {
    const { data: pending, error } = await supabase
      .from("assets")
      .select("id, design_number, name, suggested_filename, size_variant, file_path, tags")
      .eq("status", "dalle_done")
      .is("gelato_product_id", null)
      .order("design_number", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Asset query failed: ${error.message}`);
    if (!pending?.length) {
      console.log(`[${AGENT}] No pending assets to publish.`);
      await finishAgentRun(AGENT, runId, "completed", { published: 0, failed: 0, errors: [] });
      return result;
    }

    console.log(`[${AGENT}] Publishing ${pending.length} assets…`);

    for (const asset of pending) {
      // Rate limit spacing between Gelato calls
      if (result.published + result.failed > 0) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      }

      try {
        let template;
        try {
          template = templateForSizeVariant(asset.size_variant);
        } catch (err) {
          throw new Error(err instanceof Error ? err.message : String(err));
        }

        // Claim the asset so parallel runs can't double-publish it
        const { data: claimed } = await supabase
          .from("assets")
          .update({ gelato_status: "pending" })
          .eq("id", asset.id)
          .is("gelato_product_id", null)
          .or("gelato_status.is.null,gelato_status.eq.error")
          .select("id");

        if (!claimed?.length) {
          console.log(`[${AGENT}] #${asset.design_number}: already claimed, skipping`);
          continue;
        }

        const imageUrl = await publishDesignImage(asset.file_path);

        const product = await createProduct({
          templateId: template.templateId,
          title: asset.name ?? asset.suggested_filename,
          description: `Design #${asset.design_number ?? "?"}: ${asset.name ?? asset.suggested_filename}`,
          imageUrl,
          tags: Array.isArray(asset.tags) ? asset.tags : [],
        });

        const productUrl = productUrlFrom(product);

        await supabase
          .from("assets")
          .update({
            status: "gelato_pending",
            gelato_product_id: product.id,
            gelato_product_url: productUrl,
            gelato_status: "pending",
            gelato_created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", asset.id);

        result.published++;
        console.log(`[${AGENT}] ✓ #${asset.design_number} → ${product.id}`);
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`#${asset.design_number}: ${msg}`);
        console.error(`[${AGENT}] ✗ #${asset.design_number}:`, err instanceof GelatoError ? (err.details ?? msg) : err);

        // Mark failed so the admin can see it (won't block next run, error status is retriable)
        await supabase
          .from("assets")
          .update({ gelato_status: "error" })
          .eq("id", asset.id)
          .is("gelato_product_id", null);
      }
    }

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      published: result.published,
      failed: result.failed,
      errors: result.errors,
    });

    console.log(`[${AGENT}] Done: ${result.published} published, ${result.failed} failed`);
    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      published: result.published,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
