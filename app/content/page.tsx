/*
  Content review page — blog drafts and research reports.

  ── FIRST TIME SETUP ────────────────────────────────────────────────
  Run this in the Supabase SQL editor to add the published flag and
  keep existing Aisha posts visible while you review new ones:

  -- Add published column (drafts default to false)
  ALTER TABLE blog_posts
    ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

  -- Approve the posts Aisha already wrote so they stay live
  UPDATE blog_posts SET published = true;

  -- research_reports table (if not yet created)
  CREATE TABLE IF NOT EXISTS public.research_reports (
    id          uuid primary key default extensions.uuid_generate_v4(),
    topic       text not null,
    title       text not null,
    summary     text,
    body_md     text not null,
    created_at  timestamptz not null default now()
  );
  ────────────────────────────────────────────────────────────────────
*/

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ContentClient } from "./content-client";

export const metadata: Metadata = { title: "Content · CreativeOS" };

export type BlogDraft = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  god: string | null;
  country: string | null;
  reading_minutes: number | null;
  published_at: string;
  published: boolean;
  body_md: string;
};

export type ResearchReport = {
  id: string;
  topic: string;
  title: string;
  summary: string | null;
  body_md: string;
  created_at: string;
};

export default function ContentPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0a0a0a]" />}>
      <ContentData />
    </Suspense>
  );
}

async function ContentData() {
  if (!(await hasAdminCookie())) redirect("/admin/login?next=/content");

  const supabase = getSupabaseAdmin();

  const [{ data: posts }, { data: reports }] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("id, slug, title, excerpt, category, god, country, reading_minutes, published_at, published, body_md")
      .order("published_at", { ascending: false }),
    supabase
      .from("research_reports")
      .select("id, topic, title, summary, body_md, created_at")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <ContentClient
      blogPosts={(posts ?? []) as BlogDraft[]}
      reports={(reports ?? []) as ResearchReport[]}
    />
  );
}
