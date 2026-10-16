// Katrina: SEO agent.
// Writes seo_title and seo_description to assets that are missing them,
// and outputs a sitemap.xml + robots.txt to /public for Next.js to serve.

import OpenAI from "openai";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getSupabaseAdmin } from "../supabase";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Katrina";
const BATCH_SIZE = 20;
const RATE_LIMIT_MS = 500;
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hindutee.com";

export class KatrinaBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type KatrinaResult = {
  seoUpdated: number;
  sitemapUrls: number;
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

function buildSitemap(slugs: string[], lastmods: string[]): string {
  const staticPages = [
    { loc: BASE_URL, priority: "1.0", changefreq: "weekly" },
    { loc: `${BASE_URL}/shop`, priority: "0.9", changefreq: "daily" },
    { loc: `${BASE_URL}/about`, priority: "0.7", changefreq: "monthly" },
  ];

  const productEntries = slugs.map((slug, i) => ({
    loc: `${BASE_URL}/products/${slug}`,
    priority: "0.8",
    changefreq: "weekly",
    lastmod: lastmods[i] ?? new Date().toISOString().split("T")[0],
  }));

  const all = [...staticPages, ...productEntries];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${
      "lastmod" in u ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""
    }
  </url>`,
  )
  .join("\n")}
</urlset>`;
}

function buildRobots(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`;
}

export async function runKatrina(): Promise<KatrinaResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new KatrinaBusyError();
  const runId = await startAgentRun(AGENT);

  const result: KatrinaResult = { seoUpdated: 0, sitemapUrls: 0, failed: 0, errors: [] };

  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    // Write SEO for active assets missing tags
    const { data: needsSeo, error: seoError } = await supabase
      .from("assets")
      .select("id, design_number, god, country, slug")
      .eq("gelato_status", "active")
      .or("seo_title.is.null,seo_description.is.null")
      .not("slug", "is", null)
      .order("design_number", { ascending: true })
      .limit(BATCH_SIZE);

    if (seoError) throw new Error(`SEO query failed: ${seoError.message}`);

    for (const asset of needsSeo ?? []) {
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

    // Build sitemap from all active assets with slugs
    const { data: allActive } = await supabase
      .from("assets")
      .select("slug, updated_at")
      .eq("gelato_status", "active")
      .not("slug", "is", null)
      .order("design_number", { ascending: true });

    const slugs = (allActive ?? []).map(a => a.slug as string);
    const lastmods = (allActive ?? []).map(a =>
      (a.updated_at as string | null)?.split("T")[0] ?? new Date().toISOString().split("T")[0]
    );

    // Write to /public so Next.js serves them at the root
    const publicDir = join(process.cwd(), "public");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, "sitemap.xml"), buildSitemap(slugs, lastmods), "utf-8");
    writeFileSync(join(publicDir, "robots.txt"), buildRobots(), "utf-8");

    result.sitemapUrls = slugs.length + 3; // products + static pages
    console.log(`[${AGENT}] Sitemap written: ${result.sitemapUrls} URLs`);

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      seoUpdated: result.seoUpdated,
      sitemapUrls: result.sitemapUrls,
      failed: result.failed,
      errors: result.errors,
    });

    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      seoUpdated: result.seoUpdated,
      sitemapUrls: result.sitemapUrls,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
