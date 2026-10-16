// Vidya: finance agent.
// Pulls pipeline counts and Gelato order data to produce a financial snapshot.
// Outputs a Markdown report to /reports/finance.

import OpenAI from "openai";
import { getSupabaseAdmin } from "../supabase";
import { RETAIL_PRICING_USD } from "../gelato/client";
import { finishAgentRun, hasActiveRun, startAgentRun } from "./runs";

const AGENT = "Vidya";
const GELATO_COST_PER_UNIT = 14.5; // approximate base cost
const STRIPE_FEE_PCT = 0.029;
const STRIPE_FEE_FIXED = 0.30;

export class VidyaBusyError extends Error {
  constructor() {
    super(`${AGENT} is already running.`);
  }
}

export type VidyaResult = {
  reportId: string;
  liveDesigns: number;
  totalOrders: number;
  grossRevenue: number;
  netRevenue: number;
};

type PipelineData = {
  total: number;
  not_started: number;
  dalle_done: number;
  gelato_pending: number;
  gelato_done: number;
  live: number;
};

async function getPipeline(): Promise<PipelineData> {
  const { data: assets } = await getSupabaseAdmin()
    .from("assets")
    .select("status, gelato_status");

  const counts: PipelineData = { total: 0, not_started: 0, dalle_done: 0, gelato_pending: 0, gelato_done: 0, live: 0 };
  for (const a of assets ?? []) {
    counts.total++;
    if (a.status === "not_started") counts.not_started++;
    else if (a.status === "dalle_done") counts.dalle_done++;
    else if (a.status === "gelato_pending") counts.gelato_pending++;
    else if (a.status === "gelato_done") counts.gelato_done++;
    if (a.gelato_status === "active") counts.live++;
  }
  return counts;
}

type OrderData = { orders: number; gross: number; net: number; avgOrder: number };

async function getOrders(): Promise<OrderData> {
  const apiKey = process.env.GELATO_API_KEY;
  const storeId = process.env.GELATO_STORE_ID;
  if (!apiKey || !storeId) return { orders: 0, gross: 0, net: 0, avgOrder: 0 };

  try {
    const res = await fetch(
      `https://order.gelatoapis.com/v4/stores/${storeId}/orders?limit=100&orderType=order`,
      { headers: { "X-API-KEY": apiKey } },
    );
    if (!res.ok) {
      console.warn(`[${AGENT}] Gelato orders ${res.status} — using zeros`);
      return { orders: 0, gross: 0, net: 0, avgOrder: 0 };
    }
    type GelatoOrder = { price?: { value?: number } };
    const data = (await res.json()) as { orders?: GelatoOrder[] };
    const orderRows = data.orders ?? [];
    const gross = orderRows.reduce((s, o) => s + (o.price?.value ?? RETAIL_PRICING_USD.standard), 0);
    const net = orderRows.reduce((s, o) => {
      const g = o.price?.value ?? RETAIL_PRICING_USD.standard;
      return s + g - (g * STRIPE_FEE_PCT + STRIPE_FEE_FIXED) - GELATO_COST_PER_UNIT;
    }, 0);
    return {
      orders: orderRows.length,
      gross: Math.round(gross * 100) / 100,
      net: Math.round(net * 100) / 100,
      avgOrder: orderRows.length > 0 ? Math.round((gross / orderRows.length) * 100) / 100 : 0,
    };
  } catch (err) {
    console.warn(`[${AGENT}] Could not reach Gelato orders API:`, err);
    return { orders: 0, gross: 0, net: 0, avgOrder: 0 };
  }
}

async function getRecommendations(openai: OpenAI, pipeline: PipelineData, orders: OrderData): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are Vidya, finance lead at HinduTee.com. Give 3-5 specific, actionable financial recommendations. Think startup CFO. Output JSON: { \"recommendations\": [\"...\"] }",
      },
      {
        role: "user",
        content: JSON.stringify({ pipeline, orders, unitEconomics: { retail: RETAIL_PRICING_USD.standard, cost: GELATO_COST_PER_UNIT, margin: `${Math.round(((RETAIL_PRICING_USD.standard - GELATO_COST_PER_UNIT) / RETAIL_PRICING_USD.standard) * 100)}%` } }),
      },
    ],
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as { recommendations?: string[] };
  return parsed.recommendations ?? [];
}

function formatReport(pipeline: PipelineData, orders: OrderData, recommendations: string[], date: string): string {
  const contribution = RETAIL_PRICING_USD.standard - GELATO_COST_PER_UNIT - (RETAIL_PRICING_USD.standard * STRIPE_FEE_PCT + STRIPE_FEE_FIXED);
  const margin = ((contribution / RETAIL_PRICING_USD.standard) * 100).toFixed(1);

  return `# HinduTee.com — Financial Snapshot
*${new Date(date).toLocaleDateString("en-US", { dateStyle: "full" })}*

## Pipeline
| | |
|---|---|
| Total assets | ${pipeline.total} |
| Live in store | ${pipeline.live} |
| Pending Gelato | ${pipeline.gelato_pending} |
| Awaiting approval | ${pipeline.dalle_done} |
| Not started | ${pipeline.not_started} |
| **Pipeline GMV** | **$${(pipeline.live * RETAIL_PRICING_USD.standard).toFixed(2)}** |

## Revenue
| | |
|---|---|
| Total orders | ${orders.orders} |
| Gross revenue | $${orders.gross.toFixed(2)} |
| Net revenue | $${orders.net.toFixed(2)} |
| Avg order value | $${orders.avgOrder.toFixed(2)} |

## Unit Economics
| | |
|---|---|
| Retail price | $${RETAIL_PRICING_USD.standard} |
| Gelato cost | $${GELATO_COST_PER_UNIT} |
| Contribution/unit | $${contribution.toFixed(2)} |
| Gross margin | ${margin}% |
| Break-even (monthly, $500 fixed) | ${Math.ceil(500 / contribution)} units |

## Recommendations
${recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}
`;
}

export async function runVidya(): Promise<VidyaResult> {
  if (await hasActiveRun(AGENT)) throw new VidyaBusyError();
  const runId = await startAgentRun(AGENT);

  const result: VidyaResult = { reportId: "", liveDesigns: 0, totalOrders: 0, grossRevenue: 0, netRevenue: 0 };

  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const [pipeline, orders] = await Promise.all([getPipeline(), getOrders()]);
    const recommendations = await getRecommendations(openai, pipeline, orders);

    const date = new Date().toISOString();
    const report = formatReport(pipeline, orders, recommendations, date);
    const today = date.split("T")[0];

    // Save to research_reports table (same table Priya uses) so Content page can show it
    const supabase = getSupabaseAdmin();
    const { data: inserted } = await supabase
      .from("research_reports")
      .insert({
        topic: "finance",
        title: `Financial Snapshot — ${today}`,
        summary: `${pipeline.live} live · ${orders.orders} orders · $${orders.gross.toFixed(2)} gross · $${orders.net.toFixed(2)} net`,
        body_md: report,
      })
      .select("id")
      .single();

    result.reportId = inserted?.id ?? "";
    result.liveDesigns = pipeline.live;
    result.totalOrders = orders.orders;
    result.grossRevenue = orders.gross;
    result.netRevenue = orders.net;

    console.log(`[${AGENT}] Snapshot: $${orders.gross} gross · ${orders.orders} orders · ${pipeline.live} live`);

    await finishAgentRun(AGENT, runId, "completed", {
      reportId: result.reportId,
      liveDesigns: pipeline.live,
      totalOrders: orders.orders,
      grossRevenue: orders.gross,
      netRevenue: orders.net,
    });

    return result;
  } catch (err) {
    await finishAgentRun(AGENT, runId, "failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
