import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ReviewQueue, type ReviewItem } from "./review-queue";

export const metadata: Metadata = {
  title: "Review Queue · CreativeOS",
};

export default function ReviewPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex-1 bg-[#0a0a0a]" />}>
      <ReviewContent />
    </Suspense>
  );
}

// Reads the admin cookie and live data, so it renders at request time inside Suspense.
async function ReviewContent() {
  if (!(await hasAdminCookie())) redirect("/admin/login");

  const { data, error } = await getSupabaseAdmin()
    .from("assets")
    .select("id, design_number, name, suggested_filename, god, country, size_variant, file_path, collections(name)")
    .eq("status", "dalle_done")
    .order("design_number", { ascending: true });
  if (error) throw new Error(error.message);

  const items: ReviewItem[] = (data ?? []).map((a) => {
    const collection = Array.isArray(a.collections) ? a.collections[0] : a.collections;
    return {
      id: a.id,
      designNumber: a.design_number,
      name: a.name ?? a.suggested_filename ?? "Untitled design",
      filename: a.suggested_filename ?? "",
      god: a.god,
      country: a.country,
      size: a.size_variant,
      collection: collection?.name ?? null,
      filePath: a.file_path,
    };
  });

  return <ReviewQueue items={items} />;
}
