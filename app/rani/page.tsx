import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAdminCookie } from "@/lib/admin-auth";
import { getStatusSummary, type StatusSummary } from "@/lib/rani/status";
import { RaniChat } from "./chat";

export const metadata: Metadata = {
  title: "Rani · CreativeOS",
};

export default function RaniPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex-1 bg-[#0a0a0a]" />}>
      <RaniContent />
    </Suspense>
  );
}

// Reads the admin cookie and live data, so it renders at request time inside Suspense.
async function RaniContent() {
  if (!(await hasAdminCookie())) redirect("/admin/login");

  let summary: StatusSummary | null = null;
  try {
    summary = await getStatusSummary();
  } catch (err) {
    console.error("[Rani] status summary failed:", err);
  }

  return <RaniChat summary={summary} />;
}
