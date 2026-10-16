// Katrina: SEO agent.
// Writes seo_title and seo_description to assets that are missing them.
// Sitemap + robots.txt are handled by Next.js dynamic routes on hindutees-web
// (app/sitemap.ts and app/robots.ts) — no disk writes needed here.

import OpenAI from "openai";
import { getSupabaseAdmin } from "../supabase";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Katrina";
const BATCH_SIZE = 20;
const RATE_LIMIT_MS = 500;

export class KatrinaBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type KatrinaResult = {
  seoUpdated: number;
  sitemapNote: string;
  failed: number;
  errors: string[];
};

type SeoPayload = { seo_title: string; seo_description: string };

async function generateSeo(
  openai: OpenAI,
  deity: string,
  country: string,
  designNumber: number | null,
): Promise<SeoPayload> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You write SEO metadata for HinduTee.com, a Hindu deity apparel brand for the diaspora.
Target long-tail keywords like "Ganesh t-shirt Indian American" or "Hindu deity shirt Canada".
Output JSON: { "seo_title": "...", "seo_description": "..." }
Title: 50-60 chars. Description: 150-160 chars. Be specific — no generic phrases.`,
      },
      {
        role: "user",
        content: `Deity: ${deity}\nDiaspora country: ${country}\nDesign number: ${designNumber ?? "?"}`,
      },
    ],
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(response.choices[0].message.content ?? "{}") as Partial<SeoPayload>;
  return {
    seo_title: parsed.seo_title ?? `${deity} T-Shirt — ${country} Hindu Diaspora | HinduTee`,
    seo_description:
      parsed.seo_description ??
      `Celebrate ${deity} and ${country} heritage. Premium Hindu deity apparel for the diaspora. Print-on-demand, ships worldwide.`,
  };
}

export async function runKatrina(): Promise<KatrinaResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new KatrinaBusyError();
  const runId = await startAgentRun(AGENT);

  const result: KatrinaResult = {
    seoUpdated: 0,
    sitemapNote: "Sitemap is dynamic — served by /sitemap.ts route on hindutees-web, always up to date.",
    failed: 0,
    errors: [],
  };

  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Prioritize asset IDs flagged by Meera's QA audit
    const { data: flaggedIssues } = await supabase
      .from("qa_issues")
      .select("asset_id")
      .eq("owner_agent", "katrina")
      .eq("flagged_for_agent", true)
      .eq("resolved", false);
    const flaggedIds = [...new Set((flaggedIssues ?? []).map(r => r.asset_id as string))];

    // Write SEO for active assets missing tags; flagged ones first
    let needsSeoQuery = supabase
      .from("assets")
      .select("id, design_number, god, country, slug")
      .eq("gelato_status", "active")
      .or("seo_title.is.null,seo_description.is.null")
      .not("slug", "is", null)
      .order("design_number", { ascending: true })
      .limit(BATCH_SIZE);

    // If there are flagged IDs, fetch those first as a separate batch
    let priorityAssets: typeof needsSeo = [];
    if (flaggedIds.length > 0) {
      const { data: flaggedAssets } = await supabase
        .from("assets")
        .select("id, design_number, god, country, slug")
        .in("id", flaggedIds.slice(0, BATCH_SIZE));
      priorityAssets = flaggedAssets ?? [];
    }

    const { data: needsSeo, error: seoError } = await needsSeoQuery;

    if (seoError) throw new Error(`SEO query failed: ${seoError.message}`);

    // Merge: flagged assets first, then regular queue (deduplicated)
    const seenIds = new Set(priorityAssets.map(a => a.id));
    const mergedAssets = [
      ...priorityAssets,
      ...(needsSeo ?? []).filter(a => !seenIds.has(a.id)),
    ].slice(0, BATCH_SIZE);

    for (const asset of mergedAssets) {
      try {
        if (result.seoUpdated > 0) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
        const deity = asset.god?.charAt(0).toUpperCase() + (asset.god?.slice(1).toLowerCase() ?? "");
        const seo = await generateSeo(openai, deity, asset.country ?? "global", asset.design_number);
        await supabase.from("assets").update(seo).eq("id", asset.id);
        result.seoUpdated++;
        console.log(`[${AGENT}] ✓ SEO #${asset.design_number}: ${seo.seo_title}`);
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`#${asset.design_number}: ${msg}`);
        console.error(`[${AGENT}] ✗ #${asset.design_number}:`, err);
      }
    }

    console.log(`[${AGENT}] Done: ${result.seoUpdated} SEO records updated`);

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      seoUpdated: result.seoUpdated,
      sitemapNote: result.sitemapNote,
      failed: result.failed,
      errors: result.errors,
    });

    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      seoUpdated: result.seoUpdated,
      sitemapNote: result.sitemapNote,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
