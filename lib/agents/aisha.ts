// Aisha: content writing agent.
// Writes product descriptions (seo_description) for active assets,
// and generates SEO blog posts as MDX files saved to /content/blog.

import OpenAI from "openai";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
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

// Backdate blog posts spread across the past 90 days for historical coverage
function backdateFor(index: number, total: number): string {
  const end = Date.now() - 7 * 24 * 60 * 60 * 1000; // 1 week ago
  const start = end - 90 * 24 * 60 * 60 * 1000;
  const spread = total > 1 ? (end - start) / (total - 1) : 0;
  return new Date(start + spread * index).toISOString().split("T")[0];
}

async function writeDescription(openai: OpenAI, deity: string, country: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You write compelling product descriptions for HinduTee.com — premium apparel for the Hindu diaspora.
Celebrate dual cultural identity without clichés. 2-3 paragraphs. Speak to 2nd-gen Hindus directly.`,
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
  slug: string,
  backdate: string,
): Promise<{ filename: string; content: string }> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are Aisha, content writer for HinduTee.com.
Write SEO blog posts (700-900 words) that help the Hindu diaspora connect with their culture.
Blend cultural education, diaspora storytelling, and product discovery naturally — never ad-copy.
Format in Markdown with ## subheadings. Naturally reference our ${deity} × ${country} tee at /products/${slug}.
Title must be SEO-friendly and specific.`,
      },
      {
        role: "user",
        content: `Write a blog post about ${deity} and the ${country} Hindu diaspora community.`,
      },
    ],
  });

  const body = res.choices[0].message.content ?? "";
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1] ?? `${deity} and the ${country} Hindu Diaspora`;
  const excerptMatch = body.match(/\n\n([^#\n].{80,300})/m);
  const excerpt = excerptMatch?.[1]?.trim().slice(0, 200) ?? `Celebrating ${deity} in the ${country} Hindu community.`;

  const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
date: "${backdate}"
excerpt: "${excerpt.replace(/"/g, '\\"')}"
god: "${deity.toLowerCase()}"
country: "${country}"
---\n\n`;

  const filename = `${backdate}-${deity.toLowerCase()}-${country.toLowerCase().replace(/\s+/g, "-")}.mdx`;
  return { filename, content: frontmatter + body };
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

    const blogDir = join(process.cwd(), "content", "blog");
    mkdirSync(blogDir, { recursive: true });

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const deity = asset.god?.charAt(0).toUpperCase() + (asset.god?.slice(1).toLowerCase() ?? "");
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

        // Write blog post
        const backdate = backdateFor(i, assets.length);
        const { filename, content } = await writeBlogPost(openai, deity, country, asset.slug!, backdate);
        writeFileSync(join(blogDir, filename), content, "utf-8");
        result.blogsWritten++;
        console.log(`[${AGENT}] ✓ Blog: ${filename}`);
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
