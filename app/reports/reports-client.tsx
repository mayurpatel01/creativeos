"use client";

import { useState } from "react";
import type { ReportRow, AgentTile, PipelineStats } from "./page";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TOPIC_LABELS: Record<string, string> = {
  trending_product_categories: "Product Categories",
  seasonal_occasions: "Seasonal Occasions",
  competitor_analysis: "Competitor Analysis",
  diaspora_market_size: "Market Size",
  expansion_opportunities: "Expansion",
};

function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AgentTile["status"], string> = {
  running:   "bg-blue-500/15 text-blue-300 border-blue-500/40",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  failed:    "bg-red-500/15 text-red-300 border-red-500/40",
  stale:     "bg-amber-500/15 text-amber-300 border-amber-500/40",
  idle:      "bg-neutral-800 text-neutral-500 border-neutral-700",
};

const STATUS_DOT: Record<AgentTile["status"], string> = {
  running:   "bg-blue-400 animate-pulse",
  completed: "bg-emerald-400",
  failed:    "bg-red-400",
  stale:     "bg-amber-400",
  idle:      "bg-neutral-600",
};

const STATUS_LABELS: Record<AgentTile["status"], string> = {
  running:   "Running",
  completed: "Done",
  failed:    "Failed",
  stale:     "Stalled",
  idle:      "Idle",
};

function StatusPill({ status }: { status: AgentTile["status"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${STATUS_STYLES[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Summary pills from agent run data ────────────────────────────────────────

function SummaryPills({ summary }: { summary: Record<string, unknown> }) {
  const entries = Object.entries(summary).filter(([, v]) => typeof v === "number" || typeof v === "string");
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.slice(0, 5).map(([k, v]) => (
        <span key={k} className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
          <span className="text-neutral-200">{String(v)}</span>{" "}
          {k.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

// ── Agent tile ────────────────────────────────────────────────────────────────

function AgentCard({ tile }: { tile: AgentTile }) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 transition-all ${
      tile.status === "failed" || tile.status === "stale"
        ? "border-red-900/60 bg-red-950/20"
        : tile.status === "running"
        ? "border-blue-900/60 bg-blue-950/10"
        : "border-neutral-800 bg-[#111]"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-neutral-100">{tile.name}</p>
          <p className="text-[11px] text-neutral-500 mt-0.5">{tile.role}</p>
        </div>
        <StatusPill status={tile.status} />
      </div>

      {tile.lastRunAt ? (
        <div className="text-[11px] text-neutral-500 leading-snug">
          <span className="text-neutral-400">{timeAgo(tile.lastRunAt)}</span>
          {tile.completedAt && (
            <span className="ml-1 text-neutral-600">
              · {Math.round((Date.parse(tile.completedAt) - Date.parse(tile.lastRunAt)) / 1000)}s
            </span>
          )}
          <p className="mt-0.5 text-neutral-600 text-[10px]">{formatDate(tile.lastRunAt)}</p>
        </div>
      ) : (
        <p className="text-[11px] text-neutral-700">Never run</p>
      )}

      <SummaryPills summary={tile.summary} />

      {tile.href && (
        <a
          href={tile.href}
          className="mt-auto self-start text-[10px] text-[#c9a84c] hover:underline"
        >
          View {tile.name}'s work →
        </a>
      )}
    </div>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  accent,
  warn,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? "border-amber-900/60 bg-amber-950/10" : "border-neutral-800 bg-[#111]"}`}>
      <div className={`text-2xl font-bold tabular-nums ${accent ? "text-[#c9a84c]" : warn ? "text-amber-400" : "text-neutral-100"}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="mt-1 text-xs text-neutral-400">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-neutral-600">{sub}</div>}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a84c]">{title}</h2>
      {sub && <p className="text-xs text-neutral-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Platform dot ──────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "#e1306c",
  tiktok:    "#69c9d0",
  pinterest: "#e60023",
  facebook:  "#1877f2",
};

// ── Dashboard tab ─────────────────────────────────────────────────────────────

function DashboardTab({
  agentTiles,
  pipeline,
}: {
  agentTiles: AgentTile[];
  pipeline: PipelineStats;
}) {
  const mockupPct = pipeline.totalAssets > 0
    ? Math.round((pipeline.mockupsBothDone / pipeline.totalAssets) * 100)
    : 0;

  return (
    <div className="space-y-10">
      {/* Agent Status ───────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Agent Status"
          sub="Last run time and counts per agent"
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {agentTiles.map((tile) => (
            <AgentCard key={tile.name} tile={tile} />
          ))}
        </div>
      </section>

      {/* Asset Pipeline ─────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Asset Pipeline"
          sub={`${pipeline.totalAssets} total designs`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Not started"   value={pipeline.notStarted} />
          <StatTile label="In progress"   value={pipeline.inProgress} />
          <StatTile label="Ready for Gelato" value={pipeline.dalleDone} accent />
          <StatTile label="Gelato pending" value={pipeline.gelatoPending} />
          <StatTile label="Live on Gelato" value={pipeline.gelatoDone} accent />
          <StatTile
            label="Est. variants"
            value={pipeline.gelatoDone * 10}
            sub="2 colors × 5 sizes"
            accent
          />
        </div>
      </section>

      {/* Mockup Status ──────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Bipasha — Lifestyle Mockups"
          sub={`${mockupPct}% complete (${pipeline.mockupsBothDone}/${pipeline.totalAssets} both done)`}
        />
        {/* Progress bar */}
        <div className="mb-3 h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#c9a84c] transition-all duration-500"
            style={{ width: `${mockupPct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Both done ✓"      value={pipeline.mockupsBothDone} accent />
          <StatTile label="Male only"         value={pipeline.mockupsMaleDone} />
          <StatTile label="Female only"       value={pipeline.mockupsFemaleDone} />
          <StatTile
            label="Pending"
            value={pipeline.mockupsPending}
            warn={pipeline.mockupsPending > 0}
          />
        </div>
      </section>

      {/* Social Posts ───────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Social Posts — Disha"
          sub={`${pipeline.socialTotal} total posts across platforms`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile label="Total posts"  value={pipeline.socialTotal} />
          <StatTile label="Pending"      value={pipeline.socialPending} warn={pipeline.socialPending > 0} />
          <StatTile label="Posted"       value={pipeline.socialPosted} accent />
          <StatTile label="Failed"       value={pipeline.socialFailed} warn={pipeline.socialFailed > 0} />
          {Object.entries(pipeline.socialByPlatform).map(([platform, count]) => (
            <div key={platform} className="rounded-xl border border-neutral-800 bg-[#111] p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: PLATFORM_COLORS[platform] ?? "#888" }}
                />
                <span className="text-[11px] text-neutral-500 capitalize">{platform}</span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-neutral-100">{count}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Fix Backgrounds ────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Image Repair"
          sub="Fix designs saved with white backgrounds (Clipdrop failure recovery)"
        />
        <FixBackgroundsPanel />
      </section>

      {/* Blog & QA ──────────────────────────────────────── */}
      <section>
        <SectionHeader title="Content & QA" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Blog posts total"  value={pipeline.blogTotal} />
          <StatTile label="Published"         value={pipeline.blogPublished} accent />
          <StatTile label="Drafts"            value={pipeline.blogDraft} />
          <StatTile
            label="Open QA issues"
            value={pipeline.qaOpen}
            warn={pipeline.qaOpen > 0}
            sub={`of ${pipeline.qaTotal} total`}
          />
        </div>
      </section>
    </div>
  );
}

// ── Research Reports tab ──────────────────────────────────────────────────────

function ResearchTab({ reports }: { reports: ReportRow[] }) {
  const [selected, setSelected] = useState<ReportRow | null>(reports[0] ?? null);
  const topics = Array.from(new Set(reports.map((r) => r.topic)));

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <div className="text-4xl opacity-20">📊</div>
        <p className="text-neutral-500 text-sm">No reports yet — run Priya to generate market research.</p>
        <a href="/agents" className="mt-2 text-xs text-[#c9a84c] hover:underline">Go to Agents →</a>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-120px)] rounded-xl border border-neutral-800 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-neutral-800 overflow-y-auto bg-[#0d0d0d]">
        {topics.map((topic) => {
          const topicReports = reports.filter((r) => r.topic === topic);
          return (
            <div key={topic}>
              <div className="px-4 pt-4 pb-2">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-neutral-600">
                  {topicLabel(topic)}
                </span>
              </div>
              {topicReports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => setSelected(report)}
                  className={`w-full text-left px-4 py-3 transition border-l-2 ${
                    selected?.id === report.id
                      ? "border-[#c9a84c] bg-[#c9a84c]/5 text-neutral-100"
                      : "border-transparent hover:bg-neutral-900 text-neutral-400"
                  }`}
                >
                  <p className="text-xs font-medium line-clamp-2 leading-snug mb-1">{report.title}</p>
                  <p className="text-[10px] text-neutral-600">{formatDate(report.created_at)}</p>
                </button>
              ))}
            </div>
          );
        })}
      </aside>

      {/* Article */}
      <main className="flex-1 overflow-y-auto p-8 bg-[#0a0a0a]">
        {selected ? (
          <article className="max-w-3xl mx-auto">
            <div className="mb-2">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-[#c9a84c]">
                {topicLabel(selected.topic)}
              </span>
            </div>
            <h2 className="text-2xl font-semibold text-neutral-100 mb-2 leading-snug">{selected.title}</h2>
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
                prose-li:text-neutral-400 prose-strong:text-neutral-200
                prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
                prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(selected.body_md ?? "") }}
            />
          </article>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-neutral-600 text-sm">Select a report</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Fix Backgrounds panel ─────────────────────────────────────────────────────

function FixBackgroundsPanel() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ fixed: number; skipped: number; failed: number; errors: string[]; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(all = false) {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const designNumbers = all
        ? undefined
        : input
            .split(/[\s,]+/)
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n));

      const res = await fetch("/api/admin/fix-backgrounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? {} : { designNumbers }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Unknown error");
      else setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/10 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-amber-200">Fix White Backgrounds</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Re-run Clipdrop background removal on designs saved with white backgrounds. No DALL-E credits used.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 mb-1 block">
            Design numbers (comma-separated)
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 1160, 1161, 1162"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => run(false)}
            disabled={loading || !input.trim()}
            className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-white transition"
          >
            {loading ? "Fixing…" : "Fix Selected"}
          </button>
          <button
            onClick={() => run(true)}
            disabled={loading}
            className="rounded-lg border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-neutral-300 transition"
          >
            {loading ? "Fixing…" : "Scan Recent 50"}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="flex gap-4 text-sm">
            <span className="text-emerald-400">
              <span className="font-bold">{result.fixed}</span> fixed
            </span>
            <span className="text-neutral-400">
              <span className="font-bold">{result.skipped}</span> skipped (already transparent)
            </span>
            {result.failed > 0 && (
              <span className="text-red-400">
                <span className="font-bold">{result.failed}</span> failed
              </span>
            )}
          </div>
          {result.message && (
            <p className="text-[11px] text-neutral-500 mt-1">{result.message}</p>
          )}
          {result.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.errors.slice(0, 5).map((e, i) => (
                <p key={i} className="text-[10px] text-red-400 font-mono">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg border border-red-900/40 bg-red-950/20 p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── Root client component ─────────────────────────────────────────────────────

type Tab = "dashboard" | "reports";

export function ReportsClient({
  reports,
  agentTiles,
  pipeline,
}: {
  reports: ReportRow[];
  agentTiles: AgentTile[];
  pipeline: PipelineStats;
}) {
  const [tab, setTab] = useState<Tab>("dashboard");

  const anyAlert =
    agentTiles.some((t) => t.status === "failed" || t.status === "stale") ||
    pipeline.qaOpen > 0 ||
    pipeline.socialFailed > 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center gap-4 sticky top-0 bg-[#0a0a0a]/95 backdrop-blur z-10">
        <a href="/admin" className="text-neutral-500 hover:text-neutral-300 text-sm transition">
          ← Admin
        </a>
        <h1 className="text-base font-semibold text-neutral-100">HinduTees Reports</h1>
        {anyAlert && (
          <span className="ml-1 inline-flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" title="Needs attention" />
        )}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-neutral-800 bg-[#111] p-1">
          {(["dashboard", "reports"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                tab === t
                  ? "bg-[#c9a84c] text-[#0a0a0a]"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t === "dashboard" ? "Dashboard" : `Research (${reports.length})`}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {tab === "dashboard" ? (
          <DashboardTab agentTiles={agentTiles} pipeline={pipeline} />
        ) : (
          <ResearchTab reports={reports} />
        )}
      </div>
    </div>
  );
}

// ── Minimal markdown → HTML ───────────────────────────────────────────────────

function markdownToHtml(md: string): string {
  return (
    md
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      .replace(/\n\n/g, "</p><p>")
      .replace(/^(?!<[hul])/gm, "")
      .replace(/(<p><\/p>)/g, "") || `<p>${md}</p>`
  );
}
