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
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You write compelling product descriptions for HinduTee.com — premium apparel for the Hindu diaspora.
Celebrate dual cultural identity without clichés. 2-3 short paragraphs. Speak directly to 2nd-gen Hindus.
Include natural SEO terms: deity name, country, "t-shirt", "diaspora", "Hindu". Never sound like ad-copy.`,
      },
      {
        role: "user",
        content: `Write a product description for a t-shirt featuring ${deity} with ${country} diaspora symbolism.`,
      },
    ],
  });
  return res.choices[0].message.content?.trim() ?? "";
}

async function pickTargetKeyword(openai: OpenAI, deity: string, country: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an SEO strategist for HinduTee.com, a premium apparel brand for the global Hindu diaspora.
Pick ONE high-intent, rankable primary keyword for a blog post about ${deity} and the ${country} Hindu diaspora community.
The keyword should:
- Be specific enough to realistically rank (not just "Hindu t-shirt")
- Connect the deity/symbol to apparel, gifts, cultural identity, or diaspora life
- Sound like something a second-generation Hindu in ${country} would search
Good examples: "Ganesh t-shirt Indian Americans", "Krishna gifts for Hindu diaspora UK", "Durga shirt South Asian Canada", "Shiva apparel British Indian"
Return ONLY the keyword phrase — nothing else, no punctuation.`,
      },
      {
        role: "user",
        content: `Keyword for: ${deity} × ${country} Hindu diaspora apparel content`,
      },
    ],
    max_tokens: 25,
  });
  return res.choices[0].message.content?.trim() ?? `${deity} t-shirt ${country} diaspora`;
}

async function writeBlogPost(
  openai: OpenAI,
  deity: string,
  country: string,
  productSlug: string,
  backdate: string,
): Promise<{ slug: string; title: string; excerpt: string; body: string; targetKeyword: string }> {
  // Step 1: get a real target keyword
  const targetKeyword = await pickTargetKeyword(openai, deity, country);

  // Step 2: write a full-length SEO post around that keyword
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are Aisha, senior content writer for HinduTee.com — premium apparel celebrating the global Hindu diaspora.

Write a long-form SEO blog post (1,500–2,000 words) that will rank on Google AND be genuinely worth reading for ${country}-based Hindus.

PRIMARY KEYWORD: "${targetKeyword}"
Use it in:
- The H1 title (start with # )
- The first 100 words of the opening paragraph
- At least 2 H2 subheadings (## )
- Naturally 4-6 times throughout the body

STRUCTURE (use these ## sections):
1. Introduction — hook with a relatable diaspora moment, introduce the keyword
2. The Meaning of ${deity} — real cultural/spiritual depth, not Wikipedia summary
3. ${deity} in the ${country} Diaspora — specific stories, community life, cultural tension of living between worlds
4. Expressing Faith Through Fashion — how wearing ${deity} symbolism is an act of identity in ${country}
5. [One more relevant angle — festivals, gifts for parents, second-gen identity, etc.]
6. Finding the Right ${deity} Apparel — organic product discovery, link to /products/${productSlug} and mention HinduTee.com
7. Closing — call to action, invitation to share with community

SEO requirements:
- Title must include the exact keyword phrase "${targetKeyword}", be under 65 characters, and be compelling
- Open with the keyword in the first sentence or two
- Use natural keyword variations throughout (not keyword-stuffed)
- End with a line starting with META: — a 150–160 character SEO meta description using the keyword phrase

TONE: Warm, culturally fluent, first-person plural ("we", "our community"). Write like a second-gen Hindu who gets it — not a marketer, not a professor. Personal and specific beats generic and informational.

Return ONLY the article followed by the META: line. No frontmatter, no code fences.`,
      },
      {
        role: "user",
        content: `Write the full blog post targeting: "${targetKeyword}"`,
      },
    ],
    max_tokens: 3500,
  });

  const raw = res.choices[0].message.content?.trim() ?? "";

  // Extract META description if present
  const metaMatch = raw.match(/\nMETA:\s*(.+)$/m);
  const metaDescription = metaMatch?.[1]?.trim().slice(0, 160) ?? "";
  const body = raw.replace(/\nMETA:.*$/m, "").trim();

  // Extract title from first # heading
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.replace(/^#+\s*/, "").trim()
    ?? `${deity} and the ${country} Hindu Diaspora`;

  // Use meta description as excerpt if available, otherwise grab first prose paragraph
  const excerpt = metaDescription
    || body.match(/\n\n([^#\n].{80,300})/m)?.[1]?.trim().slice(0, 220)
    || `Celebrating ${deity} in the ${country} Hindu community.`;

  const slug = toSlug(`${backdate}-${deity}-${country}`);

  return { slug, title, excerpt, body, targetKeyword };
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
          const { slug, title, excerpt, body, targetKeyword } = await writeBlogPost(
            openai, deity, country, asset.slug!, backdate,
          );

          const wordCount = body.split(/\s+/).length;
          console.log(`[${AGENT}] Blog word count: ${wordCount} | keyword: "${targetKeyword}"`);

          const { error: insertErr } = await supabase.from("blog_posts").insert({
            slug,
            title,
            excerpt,
            body_md: body,
            god: asset.god,
            country,
            published_at: backdate,
            published: true,
            category: "Culture",
            reading_minutes: Math.ceil(wordCount / 200),
            target_keyword: targetKeyword,
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
