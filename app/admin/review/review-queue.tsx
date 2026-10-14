"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateProductResponse } from "../../api/gelato/create-product/route";
import type { RejectResponse } from "../../api/assets/reject/route";
import { CHECKERBOARD, requestSignedUrl } from "../thumbnails";

export type ReviewItem = {
  id: string;
  designNumber: number | null;
  name: string;
  filename: string;
  god: string | null;
  country: string | null;
  size: string | null;
  collection: string | null;
  filePath: string | null;
};

const PREFETCH_AHEAD = 3;

async function postJson<T extends { success: boolean }>(url: string, body: unknown): Promise<T | { success: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { success: false, error: "Your admin session has expired. Sign in again." };
    const json = (await res.json().catch(() => null)) as T | null;
    return json ?? { success: false, error: `Request failed (HTTP ${res.status}).` };
  } catch {
    return { success: false, error: "Couldn't reach the server." };
  }
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-200">{value ?? "—"}</dd>
    </div>
  );
}

export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const total = items.length;
  const [index, setIndex] = useState(0);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [counts, setCounts] = useState({ approved: 0, rejected: 0, skipped: 0 });

  const current = items[index];

  // Load the current image and prefetch the next few so advancing is instant.
  useEffect(() => {
    let cancelled = false;
    for (const item of items.slice(index, index + 1 + PREFETCH_AHEAD)) {
      if (!item.filePath) continue;
      const path = item.filePath;
      void requestSignedUrl(path).then((url) => {
        if (cancelled) return;
        setUrls((prev) => (prev[path] === url ? prev : { ...prev, [path]: url }));
        if (url && path !== current?.filePath) new Image().src = url;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [index, items, current?.filePath]);

  const advance = useCallback(() => {
    setError(null);
    setRejecting(false);
    setNote("");
    setIndex((i) => i + 1);
  }, []);

  const approve = useCallback(async () => {
    if (!current || busy) return;
    setBusy("approve");
    setError(null);
    const res = await postJson<CreateProductResponse>("/api/gelato/create-product", { assetId: current.id });
    setBusy(null);
    // Already on Gelato counts as done; anything else stays on this design.
    if (res.success || ("gelatoProductId" in res && res.gelatoProductId)) {
      setCounts((c) => ({ ...c, approved: c.approved + 1 }));
      advance();
    } else {
      setError(`Approve failed: ${res.error}`);
    }
  }, [current, busy, advance]);

  const confirmReject = useCallback(async () => {
    if (!current || busy) return;
    setBusy("reject");
    setError(null);
    const res = await postJson<RejectResponse>("/api/assets/reject", {
      assetId: current.id,
      note: note.trim() || undefined,
    });
    setBusy(null);
    if (res.success) {
      setCounts((c) => ({ ...c, rejected: c.rejected + 1 }));
      advance();
    } else {
      setError(`Reject failed: ${res.error}`);
    }
  }, [current, busy, note, advance]);

  function skip() {
    setCounts((c) => ({ ...c, skipped: c.skipped + 1 }));
    advance();
  }

  function openReject() {
    setRejecting(true);
    setError(null);
    requestAnimationFrame(() => noteRef.current?.focus());
  }

  // → / Space approve, ← / Backspace reject. Ignored while typing a note.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("textarea, input, select, [contenteditable='true']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || !current || busy) return;

      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        if (!rejecting) void approve();
      } else if (e.key === "ArrowLeft" || e.key === "Backspace") {
        e.preventDefault();
        if (!rejecting) openReject();
      } else if (e.key === "Escape" && rejecting) {
        setRejecting(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, busy, rejecting, approve]);

  // Refresh server data (e.g. the dashboard's pending count) once the queue is done.
  const finished = !current;
  useEffect(() => {
    if (finished) router.refresh();
  }, [finished, router]);

  const imageUrl = current?.filePath ? urls[current.filePath] : undefined;

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-[#0a0a0a] text-neutral-200">
      <header className="border-b border-neutral-800 bg-[#0d0d0d]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a84c]">CreativeOS Admin</p>
            <h1 className="text-xl font-semibold text-white">Review Queue</h1>
          </div>
          <p aria-live="polite" className="text-sm text-neutral-400 tabular-nums">
            {current
              ? `Reviewing ${index + 1} of ${total} — ${total - index - 1} remaining`
              : `${total} reviewed`}
          </p>
          <Link href="/admin" className="text-sm text-neutral-400 transition hover:text-[#c9a84c]">
            ← Admin
          </Link>
        </div>
        {total > 0 && (
          <div className="h-1 bg-neutral-900">
            <div
              className="h-full bg-[#c9a84c] transition-[width] duration-300"
              style={{ width: `${(Math.min(index, total) / total) * 100}%` }}
            />
          </div>
        )}
      </header>

      <div className="flex flex-1 items-start justify-center px-4 py-8 sm:px-6">
        {!current ? (
          <div className="mt-16 text-center">
            <p className="text-5xl text-[#7bd67f]">✓</p>
            <h2 className="mt-4 text-2xl font-semibold text-white">All caught up! 0 designs pending review</h2>
            {total > 0 && (
              <p className="mt-2 text-sm text-neutral-400">
                This session: {counts.approved} approved, {counts.rejected} rejected
                {counts.skipped > 0 && `, ${counts.skipped} skipped`}.
              </p>
            )}
            <Link
              href="/admin"
              className="mt-6 inline-block rounded-lg border border-[#c9a84c]/50 px-4 py-2 text-sm text-[#c9a84c] transition hover:bg-[#c9a84c] hover:text-[#0a0a0a]"
            >
              Back to dashboard
            </Link>
          </div>
        ) : (
          <article className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-[#111] p-5 shadow-2xl">
            <div className={`mx-auto flex aspect-square w-full max-w-[600px] items-center justify-center overflow-hidden rounded-lg ${CHECKERBOARD}`}>
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; skip image optimization
                <img
                  key={current.id}
                  src={imageUrl}
                  alt={current.name}
                  className="h-full w-full object-contain"
                  onError={() =>
                    current.filePath &&
                    void requestSignedUrl(current.filePath, true).then((url) =>
                      setUrls((prev) => ({ ...prev, [current.filePath!]: url })),
                    )
                  }
                />
              ) : imageUrl === null || !current.filePath ? (
                <p className="text-sm text-red-300">Couldn&apos;t load this image.</p>
              ) : (
                <span className="h-full w-full animate-pulse bg-neutral-800/50" />
              )}
            </div>

            <div className="mt-5 flex items-baseline justify-between gap-4">
              <p className="font-mono text-2xl font-semibold text-[#c9a84c]">
                {current.designNumber === null ? "—" : `#${current.designNumber}`}
              </p>
              <p className="truncate font-mono text-xs text-neutral-500" title={current.filename}>
                {current.filename}
              </p>
            </div>
            <h2 className="mt-1 text-lg font-medium text-white">{current.name}</h2>

            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Detail label="God" value={current.god} />
              <Detail label="Country" value={current.country} />
              <Detail label="Size" value={current.size} />
              <Detail label="Collection" value={current.collection} />
            </dl>

            {error && (
              <p role="alert" className="mt-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                {error}
              </p>
            )}

            {rejecting ? (
              <form
                className="mt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirmReject();
                }}
              >
                <label htmlFor="reject-note" className="text-xs text-neutral-400">
                  Rejection note (optional)
                </label>
                <textarea
                  id="reject-note"
                  ref={noteRef}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void confirmReject();
                    } else if (e.key === "Escape") {
                      setRejecting(false);
                    }
                  }}
                  rows={2}
                  maxLength={2000}
                  placeholder="What's wrong with it? e.g. flag colors off, deity face distorted"
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-red-800 focus:ring-1 focus:ring-red-800"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
                  >
                    {busy === "reject" ? "Rejecting…" : "✗ Confirm reject"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejecting(false)}
                    disabled={busy !== null}
                    className="rounded-lg px-4 py-2.5 text-sm text-neutral-400 transition hover:text-white"
                  >
                    Cancel
                  </button>
                  <span className="text-[11px] text-neutral-600">Enter to reject · Esc to cancel</span>
                </div>
                <p className="mt-2 text-[11px] text-neutral-500">
                  Rejecting deletes this image and sends the design back to Kajol to regenerate.
                </p>
              </form>
            ) : (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openReject}
                  disabled={busy !== null}
                  className="flex-1 rounded-lg border border-red-800 bg-red-950/40 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-900/50 disabled:opacity-50"
                >
                  ✗ Reject
                </button>
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={busy !== null}
                  className="flex-1 rounded-lg bg-[#4caf50] px-5 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#5fc463] disabled:opacity-50"
                >
                  {busy === "approve" ? "Sending to Gelato…" : "✓ Approve"}
                </button>
                <button
                  type="button"
                  onClick={skip}
                  disabled={busy !== null}
                  className="rounded-lg px-3 py-3 text-xs text-neutral-500 transition hover:text-neutral-300"
                >
                  Skip
                </button>
              </div>
            )}

            <p className="mt-3 text-center text-[11px] text-neutral-600">
              → or Space to approve · ← or Backspace to reject
            </p>
          </article>
        )}
      </div>
    </main>
  );
}
