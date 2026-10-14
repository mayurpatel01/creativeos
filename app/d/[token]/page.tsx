import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DesignerPortal, type DesignerAssignment } from "./portal";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./statuses";

export const metadata: Metadata = {
  title: "Designer Portal · CreativeOS",
  robots: { index: false, follow: false },
};

export default function DesignerPage({ params }: PageProps<"/d/[token]">) {
  return (
    <Suspense fallback={<PortalSkeleton />}>
      <DesignerContent params={params} />
    </Suspense>
  );
}

function PortalSkeleton() {
  return (
    <main className="min-h-screen flex-1 bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6">
        <div className="h-3 w-32 rounded bg-[#c9a84c]/30" />
        <div className="mt-3 h-8 w-64 rounded bg-neutral-800" />
        <div className="mt-6 h-2 w-full rounded-full bg-neutral-800" />
        <div className="mt-8 h-96 rounded-xl border border-neutral-800 bg-[#111]" />
      </div>
    </main>
  );
}

// Reads the token and live data, so it renders at request time inside Suspense.
async function DesignerContent({ params }: { params: PageProps<"/d/[token]">["params"] }) {
  const { token } = await params;
  const supabase = getSupabaseAdmin();

  const { data: designer, error: designerError } = await supabase
    .from("designers")
    .select("id, name, active")
    .eq("token", token)
    .maybeSingle();
  if (designerError) throw new Error(designerError.message);
  if (!designer || !designer.active) notFound();

  const { data, error } = await supabase
    .from("assignments")
    .select(
      "id, status, asset_id, assets(design_number, suggested_filename, dalle_prompt, god, country, size_variant, collection_id, status, designer_filename, file_url, file_path)",
    )
    .eq("designer_id", designer.id);
  if (error) throw new Error(error.message);

  const assignments: DesignerAssignment[] = (data ?? [])
    .map((row) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      const status = ASSIGNMENT_STATUSES.includes(row.status as AssignmentStatus)
        ? (row.status as AssignmentStatus)
        : "assigned";
      return {
        id: row.id,
        assetId: row.asset_id,
        status,
        designNumber: asset?.design_number ?? null,
        suggestedFilename: asset?.suggested_filename ?? "",
        dallePrompt: asset?.dalle_prompt ?? "",
        god: asset?.god ?? null,
        country: asset?.country ?? null,
        sizeVariant: asset?.size_variant ?? null,
        collectionId: asset?.collection_id ?? null,
        assetStatus: asset?.status ?? null,
        designerFilename: asset?.designer_filename ?? "",
        fileUrl: asset?.file_url ?? null,
        filePath: asset?.file_path ?? null,
      };
    })
    .sort(
      (a, b) =>
        (a.designNumber ?? Infinity) - (b.designNumber ?? Infinity) ||
        a.suggestedFilename.localeCompare(b.suggestedFilename),
    );

  return <DesignerPortal token={token} designerName={designer.name} assignments={assignments} />;
}
