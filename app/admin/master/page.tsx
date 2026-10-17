import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { MasterGrid, type MasterAsset } from "./master-grid";

export const metadata: Metadata = {
  title: "Master Approval · CreativeOS",
};

export default function MasterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] p-8 text-neutral-400">Loading designs…</div>}>
      <MasterContent />
    </Suspense>
  );
}

async function MasterContent() {
  if (!(await hasAdminCookie())) redirect("/admin/login");

  // Use "*" so Supabase's generics resolve to a plain record type —
  // a long select string produces GenericStringError in strict mode.
  const { data, error } = await getSupabaseAdmin()
    .from("assets")
    .select("*")
    .order("design_number", { ascending: true });

  if (error) throw new Error(error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assets: MasterAsset[] = ((data ?? []) as any[]).map((a) => {
    const updatedAt = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const mockupReviewedAt = a.mockup_reviewed_at ? new Date(a.mockup_reviewed_at).getTime() : null;
    const finalApprovedAt = a.final_approved_at ? new Date(a.final_approved_at).getTime() : null;
    // A design is stale only when the row was updated AFTER both the mockup review
    // and the final approval. This prevents the approval action itself (which bumps
    // updated_at) from immediately making the design look stale.
    const isStale =
      !!a.mockup_male_url &&
      !!a.mockup_female_url &&
      mockupReviewedAt !== null &&
      updatedAt > mockupReviewedAt &&
      (finalApprovedAt === null || updatedAt > finalApprovedAt);

    return {
      id: a.id,
      designNumber: a.design_number ?? null,
      name: a.name ?? a.suggested_filename ?? "Untitled",
      god: a.god ?? null,
      country: a.country ?? null,
      sizeVariant: a.size_variant ?? null,
      status: a.status,
      filePath: a.file_path ?? null,
      hasImage: !!a.file_url || !!a.file_path,
      updatedAt: a.updated_at ?? null,
      gelatoProductId: a.gelato_product_id ?? null,
      gelatoProductUrl: a.gelato_product_url ?? null,
      gelatoStatus: a.gelato_status ?? null,
      mockupMaleUrl: a.mockup_male_url ?? null,
      mockupFemaleUrl: a.mockup_female_url ?? null,
      mockupReviewedAt: a.mockup_reviewed_at ?? null,
      finalApprovedAt: a.final_approved_at ?? null,
      isStale,
    };
  });

  return <MasterGrid assets={assets} />;
}
