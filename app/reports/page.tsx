import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getLatestRuns, isStale } from "@/lib/agents/runs";
import { AGENTS } from "@/lib/agents/registry";
import { ReportsClient } from "./reports-client";

export type ReportRow = {
  id: string;
  topic: string;
  title: string;
  summary: string;
  body_md: string;
  created_at: string;
};

export type AgentTile = {
  name: string;
  role: string;
  status: "running" | "completed" | "failed" | "idle" | "stale";
  lastRunAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown>;
  href?: string;
};

export type PipelineStats = {
  // Assets
  totalAssets: number;
  notStarted: number;
  inProgress: number;
  dalleDone: number;
  gelatoPending: number;
  gelatoDone: number;
  // Mockups
  mockupsBothDone: number;
  mockupsMaleDone: number;
  mockupsFemaleDone: number;
  mockupsPending: number;
  // Social posts
  socialTotal: number;
  socialPending: number;
  socialPosted: number;
  socialFailed: number;
  socialByPlatform: Record<string, number>;
  // Blog
  blogTotal: number;
  blogDraft: number;
  blogPublished: number;
  // QA
  qaTotal: number;
  qaOpen: number;
};

export default async function ReportsPage() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get("admin_token");
  if (!adminCookie?.value) redirect("/admin/login");

  const supabase = getSupabaseAdmin();

  // Parallel fetches
  const [
    { data: reports },
    { data: assets },
    { data: socialPosts },
    { data: blogPosts },
    { data: qaIssues },
    runs,
  ] = await Promise.all([
    supabase
      .from("research_reports")
      .select("id, topic, title, summary, body_md, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("assets")
      .select("status, mockup_male_url, mockup_female_url"),
    supabase
      .from("social_posts")
      .select("platform, status"),
    supabase
      .from("blog_posts")
      .select("status"),
    supabase
      .from("qa_issues")
      .select("status")
      .limit(500),
    getLatestRuns().catch(() => new Map()),
  ]);

  // Agent tiles
  const agentTiles: AgentTile[] = AGENTS.map((agent) => {
    const run = runs.get(agent.name);
    let status: AgentTile["status"] = "idle";
    if (run) {
      if (isStale(run)) status = "stale";
      else if (run.status === "running") status = "running";
      else if (run.status === "failed") status = "failed";
      else status = "completed";
    }
    return {
      name: agent.name,
      role: agent.role,
      status,
      lastRunAt: run?.started_at ?? null,
      completedAt: run?.completed_at ?? null,
      summary: (run?.summary ?? {}) as Record<string, unknown>,
      href: agent.href,
    };
  });

  // Pipeline stats
  const a = assets ?? [];
  const IN_PROGRESS = ["dalle_done", "upscaled", "ready_for_review"];
  const pipeline: PipelineStats = {
    totalAssets: a.length,
    notStarted: a.filter((x) => x.status === "not_started").length,
    inProgress: a.filter((x) => IN_PROGRESS.includes(x.status)).length,
    dalleDone: a.filter((x) => x.status === "dalle_done").length,
    gelatoPending: a.filter((x) => x.status === "gelato_pending").length,
    gelatoDone: a.filter((x) => x.status === "gelato_done").length,
    mockupsBothDone: a.filter((x) => x.mockup_male_url && x.mockup_female_url).length,
    mockupsMaleDone: a.filter((x) => x.mockup_male_url && !x.mockup_female_url).length,
    mockupsFemaleDone: a.filter((x) => !x.mockup_male_url && x.mockup_female_url).length,
    mockupsPending: a.filter((x) => !x.mockup_male_url && !x.mockup_female_url).length,
    socialTotal: (socialPosts ?? []).length,
    socialPending: (socialPosts ?? []).filter((x) => x.status === "pending").length,
    socialPosted: (socialPosts ?? []).filter((x) => x.status === "posted").length,
    socialFailed: (socialPosts ?? []).filter((x) => x.status === "failed").length,
    socialByPlatform: (socialPosts ?? []).reduce<Record<string, number>>((acc, x) => {
      acc[x.platform] = (acc[x.platform] ?? 0) + 1;
      return acc;
    }, {}),
    blogTotal: (blogPosts ?? []).length,
    blogDraft: (blogPosts ?? []).filter((x) => x.status === "draft").length,
    blogPublished: (blogPosts ?? []).filter((x) => x.status === "published").length,
    qaTotal: (qaIssues ?? []).length,
    qaOpen: (qaIssues ?? []).filter((x) => x.status === "open").length,
  };

  return (
    <ReportsClient
      reports={(reports ?? []) as ReportRow[]}
      agentTiles={agentTiles}
      pipeline={pipeline}
    />
  );
}
