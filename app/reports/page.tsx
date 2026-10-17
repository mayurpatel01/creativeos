import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ReportsClient } from "./reports-client";

export const instant = false;

export type ReportRow = {
  id: string;
  topic: string;
  title: string;
  summary: string;
  body_md: string;
  created_at: string;
};

export default async function ReportsPage() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get("admin_token");
  if (!adminCookie?.value) redirect("/admin/login");

  const supabase = getSupabaseAdmin();

  const { data: reports } = await supabase
    .from("research_reports")
    .select("id, topic, title, summary, body_md, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return <ReportsClient reports={(reports ?? []) as ReportRow[]} />;
}
