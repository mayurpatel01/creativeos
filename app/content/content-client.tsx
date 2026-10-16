"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import type { BlogDraft, ResearchReport } from "./page";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function wordCount(md: string) {
  return md.trim().split(/\s+/).length;
}

// ─── types ──────────────────────────────────────────────────────────────────

type Tab = "blog" | "reports";

// ─── Blog post card ──────────────────────────────────────────────────────────

function BlogCard({
  post,
  onToggle,
}: {
  post: BlogDraft;
  onToggle: (id: string, published: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const res = await fetch("/api/content/toggle-blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, published: !post.published }),
      });
      if (res.ok) onToggle(post.id, !post.published);
    });
  }

  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900/60 overflow-hidden">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {post.category && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-800/50">
                {post.category}
              </span>
            )}
            {post.god && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-300 border border-violet-800/50">
                {post.god}
              </span>
            )}
            {post.country && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-900/40 text-sky-300 border border-sky-800/50">
                {post.country}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-white leading-snug mb-1">
            {post.title}
          </h3>
          {post.excerpt && (
            <p className="text-sm text-neutral-400 line-clamp-2">{post.excerpt}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-neutral-500">
            <span>{fmtDate(post.published_at)}</span>
            <span>·</span>
            <span>{post.reading_minutes ?? Math.ceil(wordCount(post.body_md) / 200)} min read</span>
            <span>·</span>
            <span className="font-mono">/blog/{post.slug}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={toggle}
            disabled={pending}
            className={`
              text-xs font-medium px-3 py-1.5 rounded-full border transition-all
              ${post.published
                ? "border-green-700 bg-green-900/30 text-green-300 hover:bg-red-900/30 hover:border-red-700 hover:text-red-300"
                : "border-neutral-600 bg-neutral-800 text-neutral-300 hover:border-green-700 hover:bg-green-900/30 hover:text-green-300"
              }
              ${pending ? "opacity-50 cursor-wait" : "cursor-pointer"}
            `}
          >
            {pending ? "…" : post.published ? "✓ Published" : "Publish"}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {expanded ? "Hide" : "Read"}
          </button>
        </div>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div className="border-t border-neutral-800 p-5">
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-p:text-neutral-300 prose-p:leading-relaxed prose-h2:text-base prose-h2:font-semibold prose-h2:mt-5 prose-h2:mb-2">
            <ReactMarkdown>{post.body_md}</ReactMarkdown>
          </div>
        </div>
      )}
    </article>
  );
}

// ─── Research report card ────────────────────────────────────────────────────

function ReportCard({ report }: { report: ResearchReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="rounded-xl border border-neutral-800 bg-neutral-900/60 overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">
              {report.topic.replace(/_/g, " ")}
            </span>
          </div>
          <h3 className="text-base font-semibold text-white leading-snug mb-1">
            {report.title}
          </h3>
          {report.summary && (
            <p className="text-sm text-neutral-400 line-clamp-2">{report.summary}</p>
          )}
          <div className="mt-2 text-xs text-neutral-500">
            {fmtDate(report.created_at)} · {Math.ceil(wordCount(report.body_md) / 200)} min read
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs shrink-0 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          {expanded ? "Collapse" : "Read report"}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-neutral-800 p-5">
          <div className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-p:text-neutral-300 prose-p:leading-relaxed prose-h2:text-base prose-h2:font-semibold prose-h2:mt-5 prose-h2:mb-2 prose-li:text-neutral-300 prose-strong:text-white">
            <ReactMarkdown>{report.body_md}</ReactMarkdown>
          </div>
        </div>
      )}
    </article>
  );
}

// ─── Main client component ───────────────────────────────────────────────────

export function ContentClient({
  blogPosts: initialPosts,
  reports,
}: {
  blogPosts: BlogDraft[];
  reports: ResearchReport[];
}) {
  const [tab, setTab] = useState<Tab>("blog");
  const [posts, setPosts] = useState<BlogDraft[]>(initialPosts);

  function handleToggle(id: string, published: boolean) {
    setPosts(prev =>
      prev.map(p => (p.id === id ? { ...p, published } : p))
    );
  }

  const published = posts.filter(p => p.published);
  const drafts = posts.filter(p => !p.published);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-[#0a0a0a]/95 backdrop-blur">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <nav className="flex items-center gap-1">
            <a
              href="/agents"
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors mr-4"
            >
              ← Agents
            </a>
            {(["blog", "reports"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t
                    ? "bg-neutral-800 text-white"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {t === "blog" ? "Blog Posts" : "Research Reports"}
                <span className="ml-1.5 text-xs opacity-60">
                  {t === "blog" ? posts.length : reports.length}
                </span>
              </button>
            ))}
          </nav>
          {tab === "blog" && (
            <div className="text-xs text-neutral-500">
              <span className="text-green-400 font-medium">{published.length} published</span>
              {" · "}
              <span>{drafts.length} draft{drafts.length !== 1 ? "s" : ""}</span>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {tab === "blog" && (
          <div className="space-y-4">
            {/* Drafts first */}
            {drafts.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold tracking-widest uppercase text-neutral-500 mb-3">
                  Drafts — pending review
                </h2>
                <div className="space-y-3">
                  {drafts.map(p => (
                    <BlogCard key={p.id} post={p} onToggle={handleToggle} />
                  ))}
                </div>
              </section>
            )}

            {published.length > 0 && (
              <section className={drafts.length > 0 ? "mt-8" : ""}>
                <h2 className="text-xs font-semibold tracking-widest uppercase text-neutral-500 mb-3">
                  Published
                </h2>
                <div className="space-y-3">
                  {published.map(p => (
                    <BlogCard key={p.id} post={p} onToggle={handleToggle} />
                  ))}
                </div>
              </section>
            )}

            {posts.length === 0 && (
              <div className="text-center py-20 text-neutral-500">
                <p className="text-4xl mb-3">✍️</p>
                <p className="text-sm">Aisha hasn't written any posts yet.</p>
                <p className="text-xs mt-1">Run her from the Agents page.</p>
              </div>
            )}
          </div>
        )}

        {tab === "reports" && (
          <div className="space-y-3">
            {reports.length === 0 ? (
              <div className="text-center py-20 text-neutral-500">
                <p className="text-4xl mb-3">📊</p>
                <p className="text-sm">Priya hasn't filed any reports yet.</p>
                <p className="text-xs mt-1">Run her from the Agents page.</p>
              </div>
            ) : (
              reports.map(r => <ReportCard key={r.id} report={r} />)
            )}
          </div>
        )}
      </div>
    </main>
  );
}
