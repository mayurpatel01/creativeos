import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SocialClient } from "./social-client";

export type SocialPostRow = {
  id: string;
  asset_id: string;
  design_number: number | null;
  god: string | null;
  country: string | null;
  platform: "instagram" | "tiktok" | "pinterest";
  caption: string;
  hashtags: string[];
  image_url: string | null;
  product_url: string | null;
  scheduled_at: string | null;
  status: "pending" | "posted" | "failed" | "skipped";
  created_at: string;
};

export default async function SocialPage() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get("admin_token");
  if (!adminCookie?.value) redirect("/admin/login");

  const supabase = getSupabaseAdmin();

  const { data: posts } = await supabase
    .from("social_posts")
    .select(
      "id, asset_id, design_number, god, country, platform, caption, hashtags, image_url, product_url, scheduled_at, status, created_at",
    )
    .order("scheduled_at", { ascending: true })
    .limit(300);

  const rows = (posts ?? []) as SocialPostRow[];

  // Summary counts
  const counts = {
    total: rows.length,
    pending: rows.filter(r => r.status === "pending").length,
    posted: rows.filter(r => r.status === "posted").length,
    failed: rows.filter(r => r.status === "failed").length,
    instagram: rows.filter(r => r.platform === "instagram").length,
    tiktok: rows.filter(r => r.platform === "tiktok").length,
    pinterest: rows.filter(r => r.platform === "pinterest").length,
  };

  return <SocialClient posts={rows} counts={counts} />;
}
