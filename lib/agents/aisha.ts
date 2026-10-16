// Aisha: content writing agent.
// Writes product descriptions (seo_description) for active assets,
// and generates SEO blog posts saved to the Supabase `blog_posts` table
// so hindutees-web can query them at runtime (no MDX files on disk).

import OpenAI from "openai";
import { getSupabaseAdmin } from "../supabase";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Aisha";
const BATCH_SIZE = 10;
const RATE_LIMIT_MS = 800;

export class AishaBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type AishaResult = {
  descriptionsWritten: number;
  blogsWritten: number;
  failed: number;
  errors: string[];
};

// Spread blog post dates across the past 90 days for historical coverage
function backdateFor(index: number, total: number): string {
  const end = Date.now() - 7 * 24 * 60 * 60 * 1000; // 1 week ago
  const start = end - 90 * 24 * 60 * 60 * 1000;
  const spread = total > 1 ? (end - start) / (total - 1) : 0;
  return new Date(start + spread * index).toISOString().split("T")[0];
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function writeDescription(openai: OpenAI, deity: string, country: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You write compelling product descriptions for HinduTee.com — premium apparel for the Hindu diaspora.
Celebrate dual cultural identity without clichés. 2-3 short paragraphs. Speak directly to 2nd-gen Hindus.`,
      },
      {
        role: "user",
        content: `Write a product description for a t-shirt featuring ${deity} with ${country} diaspora symbolism.`,
      },
    ],
  });
  return res.choices[0].message.content?.trim() ?? "";
}

async function writeBlogPost(
  openai: OpenAI,
  deity: string,
  country: string,
  productSlug: string,
  backdate: string,
): Promise<{ slug: string; title: string; excerpt: string; body: string }> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are Aisha, content writer for HinduTee.com.
Write SEO blog posts (700-900 words) that help the Hindu diaspora connect with their culture.
Blend cultural education, diaspora storytelling, and natural product discovery — never ad-copy.
Use ## subheadings. Naturally reference our ${deity} × ${country} tee near the end at /products/${productSlug}.
The title must be SEO-friendly and specific. Return only the article — no frontmatter, no code fences.`,
      },
      {
        role: "user",
        content: `Write a blog post about ${deity} and the ${country} Hindu diaspora community.`,
      },
    ],
  });

  const body = res.choices[0].message.content?.trim() ?? "";
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.replace(/^#+\s*/, "").trim()
    ?? `${deity} and the ${country} Hindu Diaspora`;
  const excerptMatch = body.match(/\n\n([^#\n].{80,300})/m);
  const excerpt = excerptMatch?.[1]?.trim().slice(0, 220)
    ?? `Celebrating ${deity} in the ${country} Hindu community.`;
  const slug = toSlug(`${backdate}-${deity}-${country}`);

  return { slug, title, excerpt, body };
}

export async function runAisha(): Promise<AishaResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new AishaBusyError();
  const runId = await startAgentRun(AGENT);

  const result: AishaResult = { descriptionsWritten: 0, blogsWritten: 0, failed: 0, errors: [] };

  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const { data: assets, error } = await supabase
      .from("assets")
      .select("id, design_number, god, country, slug, seo_description")
      .eq("gelato_status", "active")
      .not("slug", "is", null)
      .order("design_number", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Asset query failed: ${error.message}`);
    if (!assets?.length) {
      console.log(`[${AGENT}] No assets to write content for.`);
      await finishAgentRun(AGENT, runId, "completed", { descriptionsWritten: 0, blogsWritten: 0, failed: 0, errors: [] });
      return result;
    }

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const deity = asset.god
        ? asset.god.charAt(0).toUpperCase() + asset.god.slice(1).toLowerCase()
        : "Unknown";
      const country = asset.country ?? "global";

      try {
        if (i > 0) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

        // Write description if missing
        if (!asset.seo_description) {
          const description = await writeDescription(openai, deity, country);
          await supabase.from("assets").update({ seo_description: description }).eq("id", asset.id);
          result.descriptionsWritten++;
          console.log(`[${AGENT}] ✓ Description: #${asset.design_number}`);
          await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
        }

        // Write blog post if one doesn't exist for this god+country combo
        const { count } = await supabase
          .from("blog_posts")
          .select("id", { count: "exact", head: true })
          .eq("god", asset.god)
          .eq("country", country);

        if (!count || count === 0) {
          const backdate = backdateFor(i, assets.length);
          const { slug, title, excerpt, body } = await writeBlogPost(
            openai, deity, country, asset.slug!, backdate,
          );

          const { error: insertErr } = await supabase.from("blog_posts").insert({
            slug,
            title,
            excerpt,
            body_md: body,
            god: asset.god,
            country,
            published_at: backdate,
            category: "Culture",
            reading_minutes: Math.ceil(body.split(/\s+/).length / 200),
          });

          if (insertErr) throw new Error(`Blog insert failed: ${insertErr.message}`);
          result.blogsWritten++;
          console.log(`[${AGENT}] ✓ Blog: ${slug}`);
        }
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`#${asset.design_number}: ${msg}`);
        console.error(`[${AGENT}] ✗ #${asset.design_number}:`, err);
      }
    }

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      descriptionsWritten: result.descriptionsWritten,
      blogsWritten: result.blogsWritten,
      failed: result.failed,
      errors: result.errors,
    });

    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      descriptionsWritten: result.descriptionsWritten,
      blogsWritten: result.blogsWritten,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
