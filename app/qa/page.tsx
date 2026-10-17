import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { QaClient } from "./qa-client";

export type QaIssueRow = {
  id: string;
  asset_id: string;
  slug: string;
  url: string;
  issue_type: string;
  severity: "fail" | "warn";
  details: string;
  owner_agent: "katrina" | "bipasha" | "aisha" | "manual";
  resolved: boolean;
  flagged_for_agent: boolean;
  created_at: string;
};

export default async function QaPage() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get("admin_token");
  if (!adminCookie?.value) redirect("/admin/login");

  const supabase = getSupabaseAdmin();

  // Open issues grouped — most recent run's results
  const { data: issues } = await supabase
    .from("qa_issues")
    .select("*")
    .eq("resolved", false)
    .order("severity", { ascending: true }) // fail first
    .order("slug", { ascending: true })
    .limit(500);

  // Summary counts
  const allIssues = (issues ?? []) as QaIssueRow[];
  const failCount = allIssues.filter(i => i.severity === "fail").length;
  const warnCount = allIssues.filter(i => i.severity === "warn").length;
  const byAgent = {
    katrina: allIssues.filter(i => i.owner_agent === "katrina").length,
    bipasha: allIssues.filter(i => i.owner_agent === "bipasha").length,
    aisha: allIssues.filter(i => i.owner_agent === "aisha").length,
    manual: allIssues.filter(i => i.owner_agent === "manual").length,
  };

  return (
    <QaClient
      issues={allIssues}
      failCount={failCount}
      warnCount={warnCount}
      byAgent={byAgent}
    />
  );
}
