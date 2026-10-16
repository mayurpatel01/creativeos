import { getSupabaseAdmin } from "../supabase";

export type ProjectStatus = {
  name: string;
  slug: string;
  totalAssets: number;
  assetsByStatus: Record<string, number>;
  assetsByGelatoStatus: Record<string, number>;
  approved: number;
  liveInGelato: number;
  mockupsMissing: number;
};

export type StatusSummary = {
  generatedAt: string;
  projects: ProjectStatus[];
  totalAssets: number;
  totalApproved: number;
  activeDesigners: number;
  assignmentsByStatus: Record<string, number>;
};

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

// Live snapshot of creative operations, given to Rani as context on every turn.
export async function getStatusSummary(): Promise<StatusSummary> {
  const supabase = getSupabaseAdmin();

  const [projectsResult, assetsResult, designersResult, assignmentsResult] = await Promise.all([
    supabase.from("projects").select("id, name, slug").order("name"),
    supabase.from("assets").select("project_id, status, approved, gelato_status, mockup_male_url, mockup_female_url"),
    supabase.from("designers").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("assignments").select("status"),
  ]);

  for (const result of [projectsResult, assetsResult, designersResult, assignmentsResult]) {
    if (result.error) throw new Error(`Status summary query failed: ${result.error.message}`);
  }

  const assets = assetsResult.data ?? [];
  const isApproved = (a: { status: string; approved: boolean | null }) =>
    a.approved === true || a.status === "approved";

  const projects = (projectsResult.data ?? []).map((p) => {
    const projectAssets = assets.filter((a) => a.project_id === p.id);
    const liveAssets = projectAssets.filter((a) => a.gelato_status === "active");
    return {
      name: p.name,
      slug: p.slug,
      totalAssets: projectAssets.length,
      assetsByStatus: countBy(projectAssets, (a) => a.status ?? "unknown"),
      assetsByGelatoStatus: countBy(projectAssets, (a) => a.gelato_status ?? "not_synced"),
      approved: projectAssets.filter(isApproved).length,
      liveInGelato: liveAssets.length,
      mockupsMissing: liveAssets.filter(
        (a) => !a.mockup_male_url || !a.mockup_female_url
      ).length,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    projects,
    totalAssets: assets.length,
    totalApproved: assets.filter(isApproved).length,
    activeDesigners: designersResult.count ?? 0,
    assignmentsByStatus: countBy(assignmentsResult.data ?? [], (a) => a.status ?? "unknown"),
  };
}

export function formatStatusSummary(summary: StatusSummary): string {
  const lines = [
    `Live operations snapshot (as of ${summary.generatedAt}):`,
    `- Total assets: ${summary.totalAssets} (${summary.totalApproved} approved)`,
    `- Active designers: ${summary.activeDesigners}`,
    `- Designer assignments by status: ${formatCounts(summary.assignmentsByStatus)}`,
    "",
    "By project:",
  ];
  for (const p of summary.projects) {
    lines.push(
      `- ${p.name} (${p.slug}): ${p.totalAssets} assets total. ` +
        `${p.liveInGelato} live in Gelato (gelato_status=active), ${p.mockupsMissing} of those missing mockup images. ` +
        `${p.approved} approved via human review. ` +
        `By pipeline status: ${formatCounts(p.assetsByStatus)}. ` +
        `By Gelato status: ${formatCounts(p.assetsByGelatoStatus)}.`,
    );
  }
  return lines.join("\n");
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(", ") : "none";
}
