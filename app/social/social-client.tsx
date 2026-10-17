"use client";

import { useState } from "react";
import type { SocialPostRow } from "./page";

type Platform = "all" | "instagram" | "tiktok" | "pinterest";
type StatusFilter = "all" | "pending" | "posted" | "failed";

const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  instagram: { bg: "bg-pink-900/30", text: "text-pink-300", border: "border-pink-800/50" },
  tiktok:    { bg: "bg-sky-900/30",  text: "text-sky-300",  border: "border-sky-800/50" },
  pinterest: { bg: "bg-red-900/30",  text: "text-red-300",  border: "border-red-800/50" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "bg-amber-900/30",  text: "text-amber-300"  },
  posted:  { bg: "bg-green-900/30",  text: "text-green-300"  },
  failed:  { bg: "bg-red-900/30",    text: "text-red-300"    },
  skipped: { bg: "bg-neutral-800",   text: "text-neutral-500" },
};

const PLATFORM_ICONS: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  pinterest: "📌",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className="text-[10px] px-2 py-0.5 rounded border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition"
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function PostCard({ post }: { post: SocialPostRow }) {
  const [expanded, setExpanded] = useState(false);
  const pc = PLATFORM_COLORS[post.platform] ?? PLATFORM_COLORS.instagram;
  const sc = STATUS_COLORS[post.status] ?? STATUS_COLORS.skipped;
  const fullText = post.caption + (post.hashtags?.length ? "\n\n" + post.hashtags.join(" ") : "");

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 overflow-hidden hover:border-neutral-700 transition">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-neutral-800/60">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${pc.bg} ${pc.text} ${pc.border}`}>
            {PLATFORM_ICONS[post.platform]} {post.platform}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
            {post.status}
          </span>
          {post.god && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-900/30 text-violet-300 border border-violet-800/40">
              {post.god.charAt(0).toUpperCase() + post.god.slice(1).toLowerCase()}
            </span>
          )}
          {post.country && (
            <span className="text-xs text-neutral-500 uppercase tracking-wide">{post.country}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-neutral-600">{formatDate(post.scheduled_at)}</span>
          {post.design_number && (
            <span className="text-[10px] text-neutral-700 font-mono">#{post.design_number}</span>
          )}
        </div>
      </div>

      {/* Caption */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className={`text-sm text-neutral-300 leading-relaxed flex-1 ${!expanded ? "line-clamp-3" : ""}`}>
            {post.caption}
          </p>
          <CopyButton text={fullText} />
        </div>

        {/* Hashtags */}
        {post.hashtags?.length > 0 && (
          <div className="mt-2">
            <p className={`text-xs text-neutral-600 leading-relaxed ${!expanded ? "line-clamp-1" : ""}`}>
              {post.hashtags.join(" ")}
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-neutral-600 hover:text-neutral-400 transition"
          >
            {expanded ? "Show less" : `Show all · ${post.hashtags?.length ?? 0} hashtags`}
          </button>
          {post.product_url && (
            <a
              href={post.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#c9a84c] hover:underline"
            >
              Product →
            </a>
          )}
          {post.image_url && (
            <a
              href={post.image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-neutral-600 hover:text-neutral-400 transition"
            >
              Image →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function SocialClient({
  posts,
  counts,
}: {
  posts: SocialPostRow[];
  counts: {
    total: number;
    pending: number;
    posted: number;
    failed: number;
    instagram: number;
    tiktok: number;
    pinterest: number;
  };
}) {
  const [platform, setPlatform] = useState<Platform>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = posts.filter(p => {
    if (platform !== "all" && p.platform !== platform) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.caption.toLowerCase().includes(q) ||
        p.god?.toLowerCase().includes(q) ||
        p.country?.toLowerCase().includes(q) ||
        p.hashtags?.some(h => h.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center gap-4 flex-wrap">
        <a href="/admin" className="text-neutral-500 hover:text-neutral-300 text-sm transition">
          ← Admin
        </a>
        <h1 className="text-base font-semibold text-neutral-100">Social Posts</h1>

        {/* Stats chips */}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <span className="text-xs text-neutral-600">{counts.total} total</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-300">{counts.pending} pending</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-300">{counts.posted} posted</span>
          {counts.failed > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-300">{counts.failed} failed</span>
          )}
          <span className="text-xs text-neutral-600">
            📸 {counts.instagram} · 🎵 {counts.tiktok} · 📌 {counts.pinterest}
          </span>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-neutral-800 px-6 py-3 flex items-center gap-3 flex-wrap">
        {/* Platform filter */}
        <div className="flex gap-1">
          {(["all", "instagram", "tiktok", "pinterest"] as Platform[]).map(p => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                platform === p
                  ? "bg-[#c9a84c] text-[#0a0a0a]"
                  : "border border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
              }`}
            >
              {p === "all" ? "All platforms" : (PLATFORM_ICONS[p] + " " + p)}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-neutral-800" />

        {/* Status filter */}
        <div className="flex gap-1">
          {(["all", "pending", "posted", "failed"] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs transition ${
                statusFilter === s
                  ? "bg-neutral-700 text-neutral-100"
                  : "border border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search captions, deity, country…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ml-auto w-56 bg-neutral-900 border border-neutral-800 rounded-md px-3 py-1.5 text-xs text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
        />
      </div>

      {/* Content */}
      <main className="p-6">
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="text-4xl opacity-20">📱</div>
            <p className="text-neutral-500 text-sm">No posts yet — run Disha from the Agents page to generate social content.</p>
            <a href="/agents" className="mt-2 text-xs text-[#c9a84c] hover:underline">Go to Agents →</a>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-20 text-neutral-600 text-sm">No posts match your filters.</p>
        ) : (
          <>
            <p className="text-xs text-neutral-600 mb-4">{filtered.length} post{filtered.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(post => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
