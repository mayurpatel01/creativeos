// Meera: QA & Audit agent.
// Fetches each live product page on hindutees-web, checks SEO signals,
// image presence, alt tags, structured data, and OG tags.
// Writes findings to qa_issues table.
// Each issue has an owner_agent field so the UI can route fixes to the
// right agent (Katrina for SEO/alt tags, Bipasha for missing mockups).
//
// SQL to create the qa_issues table (run once in Supabase):
// ------------------------------------------------------------
// create table qa_issues (
//   id uuid primary key default gen_random_uuid(),
//   asset_id uuid references assets(id) on delete cascade,
//   slug text not null,
//   url text not null,
//   issue_type text not null,   -- 'missing_meta_title' | 'short_meta_title' | etc.
//   severity text not null,     -- 'fail' | 'warn'
//   details text,               -- human-readable explanation
//   owner_agent text not null,  -- 'katrina' | 'bipasha' | 'aisha' | 'manual'
//   resolved boolean not null default false,
//   flagged_for_agent boolean not null default false,
//   created_at timestamptz default now(),
//   run_id uuid
// );
// create index on qa_issues (asset_id);
// create index on qa_issues (resolved, owner_agent);
// ------------------------------------------------------------

import * as cheerio from "cheerio";
import { getSupabaseAdmin } from "../supabase";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Meera";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hindutee.com";
// Check up to 30 pages per run to stay within the 2-min function limit
const BATCH_SIZE = 30;

export class MeeraBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type QaIssue = {
  asset_id: string;
  slug: string;
  url: string;
  issue_type: string;
  severity: "fail" | "warn";
  details: string;
  owner_agent: "katrina" | "bipasha" | "aisha" | "manual";
  resolved: boolean;
  flagged_for_agent: boolean;
};

export type MeeraResult = {
  pagesChecked: number;
  issuesFound: number;
  issuesByAgent: Record<string, number>;
  failed: number;
  errors: string[];
};

type CheckResult = Omit<QaIssue, "asset_id" | "slug" | "url" | "resolved" | "flagged_for_agent">;

function checkPage(html: string, asset: {
  mockup_male_url: string | null;
  mockup_female_url: string | null;
}): CheckResult[] {
  const $ = cheerio.load(html);
  const issues: CheckResult[] = [];

  // ── Meta title ──────────────────────────────────────────────────────────
  const metaTitle = $("title").first().text().trim();
  if (!metaTitle) {
    issues.push({ issue_type: "missing_meta_title", severity: "fail", details: "No <title> tag found", owner_agent: "katrina" });
  } else if (metaTitle.length < 30) {
    issues.push({ issue_type: "short_meta_title", severity: "warn", details: `Title too short: ${metaTitle.length} chars (min 30)`, owner_agent: "katrina" });
  } else if (metaTitle.length > 65) {
    issues.push({ issue_type: "long_meta_title", severity: "warn", details: `Title too long: ${metaTitle.length} chars (max 65)`, owner_agent: "katrina" });
  }

  // ── Meta description ────────────────────────────────────────────────────
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() ?? "";
  if (!metaDesc) {
    issues.push({ issue_type: "missing_meta_description", severity: "fail", details: "No meta description tag found", owner_agent: "katrina" });
  } else if (metaDesc.length < 100) {
    issues.push({ issue_type: "short_meta_description", severity: "warn", details: `Description too short: ${metaDesc.length} chars (min 100)`, owner_agent: "katrina" });
  } else if (metaDesc.length > 165) {
    issues.push({ issue_type: "long_meta_description", severity: "warn", details: `Description too long: ${metaDesc.length} chars (max 165)`, owner_agent: "katrina" });
  }

  // ── H1 ──────────────────────────────────────────────────────────────────
  const h1Count = $("h1").length;
  if (h1Count === 0) {
    issues.push({ issue_type: "missing_h1", severity: "fail", details: "No <h1> tag found on page", owner_agent: "katrina" });
  } else if (h1Count > 1) {
    issues.push({ issue_type: "multiple_h1", severity: "warn", details: `${h1Count} <h1> tags found — should be exactly 1`, owner_agent: "manual" });
  }

  // ── OG tags ─────────────────────────────────────────────────────────────
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (!ogTitle) issues.push({ issue_type: "missing_og_title", severity: "warn", details: "Missing og:title tag", owner_agent: "katrina" });
  if (!ogDesc) issues.push({ issue_type: "missing_og_description", severity: "warn", details: "Missing og:description tag", owner_agent: "katrina" });
  if (!ogImage) issues.push({ issue_type: "missing_og_image", severity: "warn", details: "Missing og:image tag", owner_agent: "bipasha" });

  // ── Canonical ───────────────────────────────────────────────────────────
  const canonical = $('link[rel="canonical"]').attr("href");
  if (!canonical) {
    issues.push({ issue_type: "missing_canonical", severity: "warn", details: "No canonical link tag", owner_agent: "katrina" });
  }

  // ── JSON-LD Product schema ───────────────────────────────────────────────
  let hasProductSchema = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() ?? "{}") as { "@type"?: string };
      if (parsed["@type"] === "Product") hasProductSchema = true;
    } catch { /* ignore parse errors */ }
  });
  if (!hasProductSchema) {
    issues.push({ issue_type: "missing_product_schema", severity: "warn", details: "No JSON-LD Product schema found", owner_agent: "katrina" });
  }

  // ── Image alt tags ──────────────────────────────────────────────────────
  let imagesWithoutAlt = 0;
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    if (!alt || alt.trim() === "") imagesWithoutAlt++;
  });
  if (imagesWithoutAlt > 0) {
    issues.push({
      issue_type: "images_missing_alt",
      severity: imagesWithoutAlt > 3 ? "fail" : "warn",
      details: `${imagesWithoutAlt} image(s) missing alt text`,
      owner_agent: "katrina",
    });
  }

  // ── Mockup images (from DB, not HTML) ───────────────────────────────────
  if (!asset.mockup_male_url) {
    issues.push({ issue_type: "missing_mockup_male", severity: "fail", details: "Male lifestyle mockup image not generated", owner_agent: "bipasha" });
  }
  if (!asset.mockup_female_url) {
    issues.push({ issue_type: "missing_mockup_female", severity: "fail", details: "Female lifestyle mockup image not generated", owner_agent: "bipasha" });
  }

  return issues;
}

export async function runMeera(): Promise<MeeraResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new MeeraBusyError();
  const runId = await startAgentRun(AGENT);

  const result: MeeraResult = {
    pagesChecked: 0,
    issuesFound: 0,
    issuesByAgent: { katrina: 0, bipasha: 0, aisha: 0, manual: 0 },
    failed: 0,
    errors: [],
  };

  try {
    const { data: assets, error } = await supabase
      .from("assets")
      .select("id, slug, mockup_male_url, mockup_female_url")
      .eq("gelato_status", "active")
      .not("slug", "is", null)
      .order("design_number", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Asset query failed: ${error.message}`);
    if (!assets?.length) {
      await finishAgentRun(AGENT, runId, "completed", { pagesChecked: 0, issuesFound: 0, issuesByAgent: result.issuesByAgent, failed: 0, errors: [] });
      return result;
    }

    // Mark all existing unresolved issues for these assets as resolved before re-checking
    const assetIds = assets.map(a => a.id);
    await supabase
      .from("qa_issues")
      .update({ resolved: true })
      .in("asset_id", assetIds)
      .eq("resolved", false);

    for (const asset of assets) {
      const url = `${SITE_URL}/products/${asset.slug}`;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "HinduTee-QA-Bot/1.0 (internal audit)" },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          result.errors.push(`${asset.slug}: HTTP ${res.status}`);
          result.failed++;
          continue;
        }

        const html = await res.text();
        const checks = checkPage(html, asset);
        result.pagesChecked++;

        if (checks.length > 0) {
          const rows = checks.map(c => ({
            ...c,
            asset_id: asset.id,
            slug: asset.slug!,
            url,
            resolved: false,
            flagged_for_agent: false,
            run_id: runId,
          }));

          const { error: insertErr } = await supabase.from("qa_issues").insert(rows);
          if (insertErr) {
            console.error(`[${AGENT}] Failed to insert issues for ${asset.slug}:`, insertErr.message);
          } else {
            result.issuesFound += checks.length;
            for (const c of checks) {
              result.issuesByAgent[c.owner_agent] = (result.issuesByAgent[c.owner_agent] ?? 0) + 1;
            }
          }
        }

        console.log(`[${AGENT}] ✓ ${asset.slug}: ${checks.length} issue(s)`);
        // Brief pause to avoid hammering hindutees-web
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${asset.slug}: ${msg}`);
        result.failed++;
        console.error(`[${AGENT}] ✗ ${asset.slug}:`, msg);
      }
    }

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      pagesChecked: result.pagesChecked,
      issuesFound: result.issuesFound,
      issuesByAgent: result.issuesByAgent,
      failed: result.failed,
      errors: result.errors,
    });

    console.log(`[${AGENT}] Done: ${result.pagesChecked} pages, ${result.issuesFound} issues`);
    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      pagesChecked: result.pagesChecked,
      issuesFound: result.issuesFound,
      issuesByAgent: result.issuesByAgent,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
