"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getSignedImageUrls } from "../actions";
import { finalApproveAsset } from "./actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MasterAsset = {
  id: string;
  designNumber: number | null;
  name: string;
  god: string | null;
  country: string | null;
  sizeVariant: string | null;
  status: string;
  filePath: string | null;
  hasImage: boolean;
  updatedAt: string | null;
  gelatoProductId: string | null;
  gelatoProductUrl: string | null;
  gelatoStatus: string | null;
  mockupMaleUrl: string | null;
  mockupFemaleUrl: string | null;
  mockupReviewedAt: string | null;
  finalApprovedAt: string | null;
  isStale: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function designState(a: MasterAsset): "complete" | "stale" | "missing_mockups" | "no_image" | "pending_gelato" {
  if (!a.hasImage) return "no_image";
  if (!a.mockupMaleUrl || !a.mockupFemaleUrl) return "missing_mockups";
  if (a.isStale) return "stale";
  if (a.finalApprovedAt) return "complete";
  return "pending_gelato";
}

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  complete:        { label: "✓ Final Approved",    cls: "border-emerald-700 bg-emerald-950/60 text-emerald-300" },
  pending_gelato:  { label: "Ready to Approve",    cls: "border-blue-700 bg-blue-950/60 text-blue-300" },
  stale:           { label: "⚠ Stale Mockups",     cls: "border-orange-600 bg-orange-950/60 text-orange-300" },
  missing_mockups: { label: "Missing Mockups",     cls: "border-amber-700 bg-amber-950/60 text-amber-300" },
  no_image:        { label: "No Image",            cls: "border-neutral-700 bg-neutral-800/60 text-neutral-500" },
};

const STATUS_BADGE: Record<string, string> = {
  not_started:   "text-neutral-500",
  dalle_done:    "text-blue-400",
  gelato_pending:"text-amber-400",
  gelato_done:   "text-emerald-400",
  approved:      "text-violet-400",
  rejected:      "text-red-400",
};

// ---------------------------------------------------------------------------
// Signed URL cache (module-level, reused across renders)
// ---------------------------------------------------------------------------

const urlCache: Record<string, { url: string; expiresAt: number }> = {};

async function fetchSignedUrls(paths: string[]): Promise<Record<string, string | null>> {
  const now = Date.now();
  const fresh: Record<string, string> = {};
  const toFetch: string[] = [];

  for (const p of paths) {
    const cached = urlCache[p];
    if (cached && cached.expiresAt > now + 60_000) {
      fresh[p] = cached.url;
    } else {
      toFetch.push(p);
    }
  }

  if (toFetch.length > 0) {
    const result = await getSignedImageUrls(toFetch);
    if (result.ok) {
      for (const [path, url] of Object.entries(result.urls)) {
        if (url) {
          urlCache[path] = { url, expiresAt: result.expiresAt };
          fresh[path] = url;
        }
      }
    }
  }

  const out: Record<string, string | null> = {};
  for (const p of paths) out[p] = fresh[p] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

function Thumb({ src, label }: { src: string | null | undefined; label: string }) {
  if (!src) {
    return (
      <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-[10px] text-neutral-600">
        {label}
      </div>
    );
  }
  return (
    <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="h-full w-full object-cover" loading="lazy" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function DesignRow({ asset, signedUrl }: { asset: MasterAsset; signedUrl: string | null }) {
  const [pending, startTransition] = useTransition();
  const [localFinalApprovedAt, setLocalFinalApprovedAt] = useState<string | null>(asset.finalApprovedAt);
  const [error, setError] = useState<string | null>(null);

  // Merge server state with optimistic local state
  const effectiveAsset = { ...asset, finalApprovedAt: localFinalApprovedAt };
  const state = designState(effectiveAsset);
  const badge = STATE_BADGE[state];

  function handleFinalApprove() {
    const label = asset.designNumber !== null ? `#${asset.designNumber}` : asset.name;
    if (!window.confirm(`Final approve ${label}?\n\nThis will mark it approved and send it to Gelato (or update the existing Gelato listing).`)) return;
    setError(null);
    startTransition(async () => {
      const result = await finalApproveAsset(asset.id);
      if (result.ok) {
        setLocalFinalApprovedAt(new Date().toISOString());
      } else {
        setError(result.error);
      }
    });
  }

  const canApprove = state === "pending_gelato" || state === "stale" || state === "complete";
  const buttonLabel = pending
    ? "Approving…"
    : state === "complete"
    ? "✓ Re-Approve"
    : "Final Approve →";

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 transition sm:flex-row sm:items-start ${
      state === "complete"
        ? "border-emerald-800/50 bg-emerald-950/10"
        : state === "stale"
        ? "border-orange-800/40 bg-orange-950/10"
        : "border-neutral-800 bg-[#111]"
    }`}>
      {/* Design number + meta */}
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-44 sm:flex-shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold text-white">
            {asset.designNumber !== null ? `#${asset.designNumber}` : "—"}
          </span>
          <span className={`text-[10px] font-medium ${STATUS_BADGE[asset.status] ?? "text-neutral-400"}`}>
            {asset.status}
          </span>
        </div>
        <p className="truncate text-xs text-neutral-400">{asset.name}</p>
        {asset.god && <p className="text-[11px] text-neutral-600">{asset.god}{asset.country ? ` · ${asset.country}` : ""}</p>}
        {asset.sizeVariant && <p className="text-[11px] text-neutral-600">{asset.sizeVariant}</p>}

        {/* State badge */}
        <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>

        {/* Stale explanation */}
        {state === "stale" && asset.updatedAt && asset.mockupReviewedAt && (
          <p className="text-[10px] text-orange-400/80">
            Image updated after mockups
          </p>
        )}

        {/* Gelato link */}
        {asset.gelatoProductUrl && (
          <a
            href={asset.gelatoProductUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-neutral-600 underline decoration-dotted hover:text-neutral-400"
          >
            Gelato ↗
          </a>
        )}
      </div>

      {/* Thumbnails */}
      <div className="flex flex-1 flex-wrap gap-3">
        <div className="flex flex-col items-center gap-1">
          <Thumb src={signedUrl ?? undefined} label="No image" />
          <span className="text-[10px] text-neutral-600">Design</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Thumb src={asset.mockupFemaleUrl ?? undefined} label="No female" />
          <span className="text-[10px] text-neutral-600">Female</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Thumb src={asset.mockupMaleUrl ?? undefined} label="No male" />
          <span className="text-[10px] text-neutral-600">Male</span>
        </div>
      </div>

      {/* Approve button */}
      <div className="flex flex-col items-end gap-1 sm:w-36 sm:flex-shrink-0">
        {canApprove && (
          <button
            type="button"
            onClick={handleFinalApprove}
            disabled={pending}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
              state === "complete"
                ? "border border-emerald-700 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60"
                : "bg-[#c9a84c] text-black hover:bg-[#d4b060]"
            }`}
          >
            {buttonLabel}
          </button>
        )}
        {error && (
          <p className="text-right text-[11px] text-red-400">{error}</p>
        )}
        {localFinalApprovedAt && (
          <p className="text-right text-[10px] text-emerald-600">
            Approved {new Date(localFinalApprovedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main grid
// ---------------------------------------------------------------------------

type Filter = "all" | "needs_action" | "complete" | "no_image";

export function MasterGrid({ assets }: { assets: MasterAsset[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [signedUrls, setSignedUrls] = useState<Record<string, string | null>>({});
  const [search, setSearch] = useState("");
  const fetchedRef = useRef<Set<string>>(new Set());

  // Filter assets
  const filtered = useMemo(() => {
    let list = assets;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          (a.designNumber !== null && String(a.designNumber).includes(q)) ||
          a.name.toLowerCase().includes(q) ||
          (a.god ?? "").toLowerCase().includes(q) ||
          (a.country ?? "").toLowerCase().includes(q),
      );
    }

    if (filter === "needs_action") {
      list = list.filter((a) => {
        const s = designState(a);
        return s === "stale" || s === "missing_mockups" || s === "pending_gelato";
      });
    } else if (filter === "complete") {
      list = list.filter((a) => designState(a) === "complete");
    } else if (filter === "no_image") {
      list = list.filter((a) => designState(a) === "no_image");
    }

    return list;
  }, [assets, filter, search]);

  // Batch-fetch signed URLs for visible designs
  useEffect(() => {
    const paths = filtered
      .map((a) => a.filePath)
      .filter((p): p is string => !!p && !fetchedRef.current.has(p));

    if (paths.length === 0) return;
    for (const p of paths) fetchedRef.current.add(p);

    void fetchSignedUrls(paths).then((urls) => {
      setSignedUrls((prev) => ({ ...prev, ...urls }));
    });
  }, [filtered]);

  // Stats
  const counts = useMemo(() => {
    const states = assets.map(designState);
    return {
      total: assets.length,
      complete: states.filter((s) => s === "complete").length,
      needsAction: states.filter((s) => s === "stale" || s === "missing_mockups" || s === "pending_gelato").length,
      noImage: states.filter((s) => s === "no_image").length,
    };
  }, [assets]);

  const FILTERS: { key: Filter; label: string; count?: number }[] = [
    { key: "all",          label: "All",           count: counts.total },
    { key: "needs_action", label: "Needs Action",  count: counts.needsAction },
    { key: "complete",     label: "Complete",      count: counts.complete },
    { key: "no_image",     label: "No Image",      count: counts.noImage },
  ];

  return (
    <main className="min-h-screen flex-1 bg-[#0a0a0a]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#c9a84c]">HinduTee.com</p>
          <h1 className="mt-1 text-2xl font-bold text-white">Master Approval</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Review every design's core image and mockups in one place before pushing to Gelato.
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-6 rounded-xl border border-neutral-800 bg-[#111] p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-neutral-300">
              <span className="font-bold text-white">{counts.complete}</span> of{" "}
              <span className="font-bold text-white">{counts.total}</span> final approved
            </span>
            <span className="text-neutral-500">
              {counts.needsAction} need action · {counts.noImage} no image
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-[#c9a84c] transition-all duration-500"
              style={{ width: `${counts.total > 0 ? (counts.complete / counts.total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Search */}
          <input
            type="search"
            placeholder="Search by # or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-white placeholder-neutral-600 focus:border-neutral-500 focus:outline-none sm:max-w-xs"
          />

          {/* Filter tabs */}
          <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  filter === f.key
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {f.label}
                {f.count !== undefined && (
                  <span className={`ml-1.5 ${filter === f.key ? "text-neutral-300" : "text-neutral-600"}`}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-neutral-500">
            {search ? "No designs match that search." : "No designs in this filter."}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((asset) => (
              <DesignRow
                key={asset.id}
                asset={asset}
                signedUrl={asset.filePath ? (signedUrls[asset.filePath] ?? null) : null}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
