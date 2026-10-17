"use client";

import { useState } from "react";
import type { ReportRow } from "./page";

const TOPIC_LABELS: Record<string, string> = {
  trending_product_categories: "Product Categories",
  seasonal_occasions: "Seasonal Occasions",
  competitor_analysis: "Competitor Analysis",
  diaspora_market_size: "Market Size",
  expansion_opportunities: "Expansion",
};

function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReportsClient({ reports }: { reports: ReportRow[] }) {
  const [selected, setSelected] = useState<ReportRow | null>(reports[0] ?? null);

  const topics = Array.from(new Set(reports.map(r => r.topic)));

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center gap-4">
        <a href="/admin" className="text-neutral-500 hover:text-neutral-300 text-sm transition">
          ← Admin
        </a>
        <h1 className="text-base font-semibold text-neutral-100">Priya's Research Reports</h1>
        <span className="ml-auto text-xs text-neutral-500">{reports.length} report{reports.length !== 1 ? "s" : ""}</span>
      </header>

      {reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="text-4xl opacity-20">📊</div>
          <p className="text-neutral-500 text-sm">No reports yet — run Priya from the Agents page to generate market research.</p>
          <a href="/agents" className="mt-2 text-xs text-[#c9a84c] hover:underline">Go to Agents →</a>
        </div>
      ) : (
        <div className="flex h-[calc(100vh-57px)]">
          {/* Sidebar */}
          <aside className="w-72 shrink-0 border-r border-neutral-800 overflow-y-auto">
            {/* Group by topic */}
            {topics.map(topic => {
              const topicReports = reports.filter(r => r.topic === topic);
              return (
                <div key={topic}>
                  <div className="px-4 pt-4 pb-2">
                    <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">
                      {topicLabel(topic)}
                    </span>
                  </div>
                  {topicReports.map(report => (
                    <button
                      key={report.id}
                      onClick={() => setSelected(report)}
                      className={`w-full text-left px-4 py-3 transition border-l-2 ${
                        selected?.id === report.id
                          ? "border-[#c9a84c] bg-[#c9a84c]/5 text-neutral-100"
                          : "border-transparent hover:bg-neutral-900 text-neutral-400"
                      }`}
                    >
                      <p className="text-xs font-medium line-clamp-2 leading-snug mb-1">
                        {report.title}
                      </p>
                      <p className="text-[10px] text-neutral-600">{formatDate(report.created_at)}</p>
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto p-8">
            {selected ? (
              <article className="max-w-3xl mx-auto">
                <div className="mb-2">
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-[#c9a84c]">
                    {topicLabel(selected.topic)}
                  </span>
                </div>
                <h2 className="text-2xl font-semibold text-neutral-100 mb-2 leading-snug">
                  {selected.title}
                </h2>
                <p className="text-xs text-neutral-500 mb-6">{formatDate(selected.created_at)}</p>

                {selected.summary && (
                  <div className="mb-6 p-4 rounded-lg bg-[#c9a84c]/10 border border-[#c9a84c]/20">
                    <p className="text-sm text-neutral-300 leading-relaxed">{selected.summary}</p>
                  </div>
                )}

                <div
                  className="prose prose-invert prose-sm max-w-none
                    prose-headings:text-neutral-100 prose-headings:font-semibold
                    prose-p:text-neutral-400 prose-p:leading-relaxed
                    prose-li:text-neutral-400
                    prose-strong:text-neutral-200
                    prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                    prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2"
                  dangerouslySetInnerHTML={{
                    __html: markdownToHtml(selected.body_md ?? ""),
                  }}
                />
              </article>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-neutral-600 text-sm">Select a report</p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

// Minimal markdown → HTML (no library needed for Priya's structured output)
function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hul])/gm, "")
    .replace(/(<p><\/p>)/g, "")
    || `<p>${md}</p>`;
}
