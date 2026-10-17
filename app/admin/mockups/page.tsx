import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { MockupQueue, type MockupItem } from "./mockup-queue";

export const metadata: Metadata = {
  title: "Mockup Review · CreativeOS",
};

export default function MockupReviewPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex-1 bg-[#0a0a0a]" />}>
      <MockupContent />
    </Suspense>
  );
}

async function MockupContent() {
  if (!(await hasAdminCookie())) redirect("/admin/login");

  const { data, error } = await getSupabaseAdmin()
    .from("assets")
    .select("id, design_number, name, suggested_filename, god, country, size_variant, mockup_male_url, mockup_female_url")
    // Show assets with at least one mockup that hasn't been reviewed yet
    .or("mockup_male_url.not.is.null,mockup_female_url.not.is.null")
    .is("mockup_reviewed_at", null)
    .order("design_number", { ascending: true });

  if (error) throw new Error(error.message);

  const items: MockupItem[] = (data ?? []).map((a) => ({
    id: a.id,
    designNumber: a.design_number,
    name: a.name ?? a.suggested_filename ?? "Untitled design",
    god: a.god,
    country: a.country,
    size: a.size_variant,
    mockupMaleUrl: a.mockup_male_url,
    mockupFemaleUrl: a.mockup_female_url,
  }));

  return <MockupQueue items={items} />;
}
