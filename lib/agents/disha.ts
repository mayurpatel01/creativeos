// Disha: social media agent.
// Generates ready-to-post captions + hashtags for Instagram, TikTok, and Pinterest.
// Outputs a content calendar JSON + CSV to /content/social.

import OpenAI from "openai";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getSupabaseAdmin } from "../supabase";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Disha";
const BATCH_SIZE = 10;
const RATE_LIMIT_MS = 600;
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hindutee.com";

export class DishaBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type DishaPlatform = "instagram" | "tiktok" | "pinterest";
export type DishaPost = {
  asset_id: string;
  design_number: number | null;
  god: string;
  country: string;
  platform: DishaPlatform;
  image_url: string | null;
  caption: string;
  hashtags: string[];
  post_date: string;
  product_url: string;
};
export type DishaResult = {
  postsGenerated: number;
  failed: number;
  errors: string[];
  calendarPath: string;
};

const PLATFORMS: DishaPlatform[] = ["instagram", "tiktok", "pinterest"];

const PLATFORM_INSTRUCTIONS: Record<DishaPlatform, string> = {
  instagram: "Instagram: 150-200 chars, warm cultural tone, ends with CTA. 15-20 hashtags.",
  tiktok: "TikTok: 80-100 chars, punchy, POV-style, young diaspora energy. 5-8 trending hashtags.",
  pinterest: "Pinterest: 180-250 chars, SEO-rich, product-focused. 12-15 keyword hashtags.",
};

// Spread posts across the next 30 days at platform-appropriate times
function scheduleDate(postIndex: number, platform: DishaPlatform): string {
  const hours = { instagram: 9, tiktok: 19, pinterest: 14 };
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(postIndex / 3));
  d.setHours(hours[platform], 0, 0, 0);
  return d.toISOString();
}

async function generatePost(
  openai: OpenAI,
  deity: string,
  country: string,
  platform: DishaPlatform,
  productUrl: string,
): Promise<{ caption: string; hashtags: string[] }> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are Disha, social media voice of HinduTee.com — Hindu deity apparel for the diaspora.
Your content is culturally fluent, modern, and celebrates dual identity without appropriating.
Speak to 2nd-gen Hindus proud of their roots. Output JSON: { "caption": "...", "hashtags": ["#tag"] }`,
      },
      {
        role: "user",
        content: `Create ${platform} content for our ${deity} × ${country} tee.
${PLATFORM_INSTRUCTIONS[platform]}
Product link: ${productUrl}`,
      },
    ],
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as { caption?: string; hashtags?: string[] };
  return { caption: parsed.caption ?? "", hashtags: parsed.hashtags ?? [] };
}

export async function runDisha(): Promise<DishaResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new DishaBusyError();
  const runId = await startAgentRun(AGENT);

  const result: DishaResult = { postsGenerated: 0, failed: 0, errors: [], calendarPath: "" };

  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const { data: assets, error } = await supabase
      .from("assets")
      .select("id, design_number, god, country, slug, gelato_product_url, file_url, mockup_female_url, mockup_male_url")
      .eq("gelato_status", "active")
      .order("design_number", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Asset query failed: ${error.message}`);
    if (!assets?.length) {
      console.log(`[${AGENT}] No active assets to generate content for.`);
      await finishAgentRun(AGENT, runId, "completed", { postsGenerated: 0, failed: 0, errors: [], calendarPath: "" });
      return result;
    }

    const posts: DishaPost[] = [];
    let postIndex = 0;

    for (const asset of assets) {
      const deity = asset.god?.charAt(0).toUpperCase() + (asset.god?.slice(1).toLowerCase() ?? "");
      const country = asset.country ?? "global";
      const productUrl = asset.gelato_product_url ?? `${BASE_URL}/products/${asset.slug ?? asset.id}`;
      const imageUrl = asset.mockup_female_url ?? asset.mockup_male_url ?? asset.file_url;

      for (const platform of PLATFORMS) {
        try {
          if (posts.length > 0) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
          const { caption, hashtags } = await generatePost(openai, deity, country, platform, productUrl);
          posts.push({
            asset_id: asset.id,
            design_number: asset.design_number,
            god: deity,
            country,
            platform,
            image_url: imageUrl,
            caption,
            hashtags,
            post_date: scheduleDate(postIndex, platform),
            product_url: productUrl,
          });
          result.postsGenerated++;
          postIndex++;
        } catch (err) {
          result.failed++;
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`#${asset.design_number}/${platform}: ${msg}`);
          console.error(`[${AGENT}] ✗ #${asset.design_number}/${platform}:`, err);
        }
      }
    }

    // Sort by scheduled date
    posts.sort((a, b) => new Date(a.post_date).getTime() - new Date(b.post_date).getTime());

    const socialDir = join(process.cwd(), "content", "social");
    mkdirSync(socialDir, { recursive: true });

    const today = new Date().toISOString().split("T")[0];
    const calendarPath = join(socialDir, `content-calendar-${today}.json`);
    writeFileSync(calendarPath, JSON.stringify({ generated_at: new Date().toISOString(), posts }, null, 2), "utf-8");

    // CSV for importing into scheduling tools
    const csvLines = ["platform,post_date,god,country,caption,hashtags,image_url,product_url"];
    for (const p of posts) {
      csvLines.push([
        p.platform,
        p.post_date,
        p.god,
        p.country,
        `"${p.caption.replace(/"/g, '""')}"`,
        `"${p.hashtags.join(" ")}"`,
        p.image_url ?? "",
        p.product_url,
      ].join(","));
    }
    writeFileSync(join(socialDir, `content-calendar-${today}.csv`), csvLines.join("\n"), "utf-8");

    result.calendarPath = calendarPath;
    console.log(`[${AGENT}] Done: ${result.postsGenerated} posts → ${calendarPath}`);

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      postsGenerated: result.postsGenerated,
      failed: result.failed,
      errors: result.errors,
    });

    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      postsGenerated: result.postsGenerated,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
