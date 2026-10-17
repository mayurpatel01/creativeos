import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasAdminCookie, isValidAdminKey } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AdminDashboard, type AdminAsset } from "./dashboard";

export const metadata: Metadata = {
  title: "Admin · CreativeOS",
};

const PROJECT_SLUG = "hindu-tees";

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <AdminContent searchParams={searchParams} />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <main className="min-h-screen flex-1 bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6">
        <div className="h-3 w-32 rounded bg-[#c9a84c]/30" />
        <div className="mt-3 h-8 w-56 rounded bg-neutral-800" />
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[86px] rounded-xl border border-neutral-800 bg-[#111]" />
          ))}
        </div>
        <div className="mt-6 h-96 rounded-xl border border-neutral-800 bg-[#111]" />
      </div>
    </main>
  );
}

// Reads cookies, searchParams and live data, so it renders at request time inside Suspense.
async function AdminContent({
  searchParams,
}: {
  searchParams: PageProps<"/admin">["searchParams"];
}) {
  if (!(await hasAdminCookie())) {
    const { adminKey } = await searchParams;
    const key = typeof adminKey === "string" ? adminKey : null;
    if (isValidAdminKey(key)) {
      // Swap the query param for a cookie so Server Actions are authorized too.
      redirect(`/api/admin/auth?adminKey=${encodeURIComponent(key!)}`);
    }
    redirect("/admin/login");
  }

  const supabase = getSupabaseAdmin();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("slug", PROJECT_SLUG)
    .single();
  if (projectError || !project) {
    throw new Error(`Project '${PROJECT_SLUG}' not found: ${projectError?.message}`);
  }

  const [assetsResult, collectionsResult, assignmentsResult, designersResult] =
    await Promise.all([
      supabase
        .from("assets")
        // "*" rather than a column list so the page still loads before the Gelato
        // migration adds the gelato_* columns.
        .select("*, collections(name)")
        .eq("project_id", project.id)
        .order("design_number"),
      supabase
        .from("collections")
        .select("id, name")
        .eq("project_id", project.id)
        .order("sort_order"),
      supabase
        .from("assignments")
        .select("asset_id, designer_id, status, created_at, designers(name)")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("designers")
        .select("id, name, speciality")
        .eq("active", true)
        .order("name"),
    ]);

  for (const result of [assetsResult, collectionsResult, assignmentsResult, designersResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  // Results are newest first, so the first assignment seen per asset is the current one.
  const assignmentByAsset = new Map<
    string,
    { designer: { id: string; name: string }; status: string }
  >();
  for (const a of assignmentsResult.data ?? []) {
    if (!assignmentByAsset.has(a.asset_id)) {
      const designer = Array.isArray(a.designers) ? a.designers[0] : a.designers;
      assignmentByAsset.set(a.asset_id, {
        designer: { id: a.designer_id, name: designer?.name ?? "Unknown" },
        status: a.status,
      });
    }
  }

  const assets: AdminAsset[] = (assetsResult.data ?? []).map((a) => {
    const collection = Array.isArray(a.collections) ? a.collections[0] : a.collections;
    return {
      id: a.id,
      designNumber: a.design_number ?? null,
      filePath: a.file_url ? (a.file_path ?? null) : null,
      filename: a.suggested_filename ?? "—",
      god: a.god,
      country: a.country,
      size: a.size_variant,
      status: a.status,
      collectionId: a.collection_id,
      collectionName: collection?.name ?? "—",
      designer: assignmentByAsset.get(a.id)?.designer ?? null,
      assignmentStatus: assignmentByAsset.get(a.id)?.status ?? null,
      gelatoProductId: a.gelato_product_id ?? null,
      gelatoProductUrl: a.gelato_product_url ?? null,
      gelatoStatus: a.gelato_status ?? null,
      mockupMaleUrl: a.mockup_male_url ?? null,
      mockupFemaleUrl: a.mockup_female_url ?? null,
      mockupReviewedAt: a.mockup_reviewed_at ?? null,
    };
  });

  return (
    <AdminDashboard
      projectName={project.name}
      assets={assets}
      collections={collectionsResult.data ?? []}
      designers={designersResult.data ?? []}
    />
  );
}
