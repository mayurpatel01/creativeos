// Priya: market research agent.
// Tracks trending apparel products, categories, and diaspora occasions.
// Saves research reports to the `research_reports` table in Supabase
// so Rani and the team can act on them.
//
// Uses GPT-4o to synthesize trends across:
// - Print-on-demand apparel categories (hats, hoodies, phone cases, mugs, etc.)
// - Hindu diaspora seasonal occasions (Diwali, Navratri, Holi, Ganesh Chaturthi, etc.)
// - Competitor and market signals
// - Gelato product catalog expansion opportunities

import OpenAI from "openai";
import { getSupabaseAdmin } from "../supabase";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Priya";

export class PriyaBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type PriyaResult = {
  reportsWritten: number;
  failed: number;
  errors: string[];
};

type ResearchSection = {
  topic: string;
  prompt: string;
};

const RESEARCH_TOPICS: ResearchSection[] = [
  {
    topic: "trending_product_categories",
    prompt: `You are a market research analyst specializing in print-on-demand apparel for cultural/diaspora markets.

Research topic: Trending product categories for HinduTee.com (currently sells t-shirts only).

HinduTee.com sells premium Hindu deity × diaspora country flag apparel. Core customer: 2nd-gen South Asian diaspora in USA, Canada, UK, Australia, Guyana, Trinidad, Fiji. Currently only sells t-shirts.

Analyze and recommend:
1. Top 5 product categories to expand into (hats, hoodies, phone cases, mugs, tote bags, sweatshirts, etc.) — rank by: profit margin on Gelato, diaspora cultural fit, gifting potential
2. For each category: specific product type, why it fits the brand, estimated demand signal, and which deities/countries would sell best on it
3. Seasonal gifting opportunities (Diwali gifts, graduation season, wedding favor market)
4. Price point recommendations per category
5. Which Gelato product types map to these opportunities

Be specific and actionable. No fluff.`,
  },
  {
    topic: "diaspora_occasions_calendar",
    prompt: `You are a market research analyst specializing in Hindu diaspora cultural marketing.

Research topic: Hindu diaspora occasions calendar for HinduTee.com product and content planning.

HinduTee.com sells Hindu deity × diaspora flag t-shirts. Core customer: 2nd-gen Hindus in USA, Canada, UK, Australia, Guyana, Trinidad, Fiji, South Africa.

Build a 12-month occasions calendar covering:
1. Major Hindu festivals with diaspora significance (Diwali, Navratri, Holi, Ganesh Chaturthi, Krishna Janmashtami, Ram Navami, Maha Shivaratri)
2. Country-specific holidays relevant to the diaspora (Republic Day India, Independence Day Trinidad, etc.)
3. Cultural moments (Indo-Caribbean Heritage Month, South Asian Heritage Month UK, etc.)
4. Peak gifting/shopping windows for each occasion
5. Which deities are most associated with each occasion
6. Recommended marketing lead time (when to start promoting)

Format as a structured month-by-month breakdown. Be specific about dates and diaspora community relevance.`,
  },
  {
    topic: "competitor_analysis",
    prompt: `You are a market research analyst for HinduTee.com — a print-on-demand Hindu deity × diaspora flag apparel brand.

Research topic: Competitive landscape and differentiation opportunities.

Core customer: 2nd-gen South Asian diaspora (Hindus) in USA, Canada, UK, Australia, Guyana, Trinidad, Fiji.
Current products: T-shirts with Hindu deity (Ganesh, Shiva, Hanuman, Krishna, Lakshmi, Durga, Om) × 16 diaspora countries.
Fulfillment: Gelato print-on-demand.

Analyze:
1. Direct competitors (Hindu cultural apparel brands, diaspora flag clothing, South Asian streetwear)
2. What they're doing well and where the gaps are
3. Design trends in the South Asian diaspora fashion space
4. Price positioning — where does $29.99 base sit in the market?
5. 3 specific differentiation opportunities HinduTee could own
6. Content and community strategies competitors are using that work

Be specific — name real brands or categories you know about. Flag where your knowledge may be dated.`,
  },
];

async function runResearchTopic(
  openai: OpenAI,
  section: ResearchSection,
): Promise<string> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: section.prompt }],
    temperature: 0.4,
  });
  return res.choices[0].message.content?.trim() ?? "";
}

export async function runPriya(): Promise<PriyaResult> {
  const supabase = getSupabaseAdmin();

  if (await hasActiveRun(AGENT)) throw new PriyaBusyError();
  const runId = await startAgentRun(AGENT);

  const result: PriyaResult = { reportsWritten: 0, failed: 0, errors: [] };

  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const today = new Date().toISOString().split("T")[0];

  try {
    for (const section of RESEARCH_TOPICS) {
      try {
        console.log(`[${AGENT}] Researching: ${section.topic}…`);
        const content = await runResearchTopic(openai, section);

        const { error } = await supabase.from("research_reports").insert({
          agent: AGENT,
          topic: section.topic,
          content,
          generated_at: today,
        });

        if (error) throw new Error(`Insert failed: ${error.message}`);
        result.reportsWritten++;
        console.log(`[${AGENT}] ✓ ${section.topic}`);

        // Avoid rate limits between GPT-4o calls
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${section.topic}: ${msg}`);
        console.error(`[${AGENT}] ✗ ${section.topic}:`, err);
      }
    }

    await finishAgentRun(AGENT, runId, result.failed === 0 ? "completed" : "failed", {
      reportsWritten: result.reportsWritten,
      failed: result.failed,
      errors: result.errors,
    });

    console.log(`[${AGENT}] Done: ${result.reportsWritten} reports written`);
    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", {
      reportsWritten: result.reportsWritten,
      failed: result.failed,
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
}
