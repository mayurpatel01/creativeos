"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { MockupReviewResponse } from "../../api/assets/mockup-review/route";

export type MockupItem = {
  id: string;
  designNumber: number | null;
  name: string;
  god: string | null;
  country: string | null;
  size: string | null;
  mockupMaleUrl: string | null;
  mockupFemaleUrl: string | null;
  fileUrl: string | null;
};

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

function MockupPanel({
  label,
  url,
  isRedo,
  onToggle,
}: {
  label: string;
  url: string | null;
  isRedo: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{label}</span>
        {url && (
          <button
            type="button"
            onClick={onToggle}
            className={`rounded px-2 py-0.5 text-xs font-semibold transition ${
              isRedo
                ? "bg-orange-700 text-white hover:bg-orange-600"
                : "border border-neutral-700 text-neutral-400 hover:border-orange-700 hover:text-orange-400"
            }`}
          >
            {isRedo ? "↺ Redo (marked)" : "↺ Redo"}
          </button>
        )}
      </div>
      <div
        className="relative aspect-square w-full overflow-hidden rounded-lg"
        style={{
          background: url
            ? "transparent"
            : "#111",
          border: isRedo
            ? "2px solid #c2440f"
            : "1px solid #262626",
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            className={`h-full w-full object-cover transition-opacity duration-200 ${isRedo ? "opacity-50" : "opacity-100"}`}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-600">
            No mockup
          </div>
        )}
        {isRedo && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-orange-700/90 px-3 py-1 text-xs font-bold text-white">
              REDO
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-neutral-200">{value ?? "—"}</dd>
    </div>
  );
}

export function MockupQueue({ items }: { items: MockupItem[] }) {
  const router = useRouter();
  const total = items.length;
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redoMale, setRedoMale] = useState(false);
  const [redoFemale, setRedoFemale] = useState(false);
  const [counts, setCounts] = useState({ approved: 0, redone: 0, skipped: 0 });

  const current = items[index];

  // Reset redo selections when item changes
  useEffect(() => {
    setRedoMale(false);
    setRedoFemale(false);
    setError(null);
  }, [index]);

  const advance = useCallback(() => {
    setIndex((i) => i + 1);
  }, []);

  const skip = useCallback(() => {
    if (!current || busy) return;
    setCounts((c) => ({ ...c, skipped: c.skipped + 1 }));
    setRedoMale(false);
    setRedoFemale(false);
    setError(null);
    advance();
  }, [current, busy, advance]);

  const submit = useCallback(async () => {
    if (!current || busy) return;

    let action: "approve" | "redo_male" | "redo_female" | "redo_both";
    if (redoMale && redoFemale) action = "redo_both";
    else if (redoMale) action = "redo_male";
    else if (redoFemale) action = "redo_female";
    else action = "approve";

    setBusy(true);
    setError(null);

    const res = await postJson<MockupReviewResponse>("/api/assets/mockup-review", {
      assetId: current.id,
      action,
    });

    setBusy(false);

    if (res.success) {
      if (action === "approve") {
        setCounts((c) => ({ ...c, approved: c.approved + 1 }));
      } else {
        setCounts((c) => ({ ...c, redone: c.redone + 1 }));
      }
      advance();
    } else {
      setError(`Failed: ${res.error}`);
    }
  }, [current, busy, redoMale, redoFemale, advance]);

  // Keyboard: Space/→ to submit, Escape to clear redo selections
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("textarea, input, select, [contenteditable='true']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || !current || busy) return;

      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        void submit();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        skip();
      } else if (e.key === "Escape") {
        setRedoMale(false);
        setRedoFemale(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, busy, submit, skip]);

  // Refresh once the queue is done
  const finished = !current;
  useEffect(() => {
    if (finished) router.refresh();
  }, [finished, router]);

  const hasRedoSelection = redoMale || redoFemale;

  return (
    <main className="flex min-h-screen flex-1 flex-col bg-[#0a0a0a] text-neutral-200">
      <header className="border-b border-neutral-800 bg-[#0d0d0d]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a84c]">CreativeOS Admin</p>
            <h1 className="text-xl font-semibold text-white">Mockup Review</h1>
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
            <h2 className="mt-4 text-2xl font-semibold text-white">All mockups reviewed!</h2>
            {total > 0 && (
              <p className="mt-2 text-sm text-neutral-400">
                This session: {counts.approved} approved, {counts.redone} flagged for redo
                {counts.skipped > 0 ? `, ${counts.skipped} skipped` : ""}.
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
          <article className="w-full max-w-3xl rounded-xl border border-neutral-800 bg-[#111] p-5 shadow-2xl">
            {/* Design metadata */}
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <p className="font-mono text-2xl font-semibold text-[#c9a84c]">
                {current.designNumber === null ? "—" : `#${current.designNumber}`}
              </p>
              <h2 className="truncate text-lg font-medium text-white">{current.name}</h2>
            </div>

            <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Detail label="God" value={current.god} />
              <Detail label="Country" value={current.country} />
              <Detail label="Size" value={current.size} />
              <Detail
                label="Mockups"
                value={[current.mockupMaleUrl ? "Male ✓" : "Male ✗", current.mockupFemaleUrl ? "Female ✓" : "Female ✗"].join(" · ")}
              />
            </dl>

            {/* Original design + mockup panels */}
            <div className="grid grid-cols-3 gap-4">
              {/* Original design thumbnail */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Original</span>
                </div>
                <div
                  className="relative aspect-square w-full overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900"
                  style={{ backgroundImage: "repeating-conic-gradient(#1a1a1a 0% 25%, #111 0% 50%)", backgroundSize: "16px 16px" }}
                >
                  {current.fileUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={current.fileUrl}
                      alt="Original design"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-neutral-600">
                      No source file
                    </div>
                  )}
                </div>
              </div>

              <MockupPanel
                label="Male"
                url={current.mockupMaleUrl}
                isRedo={redoMale}
                onToggle={() => setRedoMale((v) => !v)}
              />
              <MockupPanel
                label="Female"
                url={current.mockupFemaleUrl}
                isRedo={redoFemale}
                onToggle={() => setRedoFemale((v) => !v)}
              />
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                {error}
              </p>
            )}

            {/* Help text when redo is selected */}
            {hasRedoSelection && (
              <p className="mt-3 rounded-lg bg-orange-950/40 border border-orange-900/50 px-3 py-2 text-xs text-orange-300">
                {redoMale && redoFemale
                  ? "Both mockups will be cleared — Bipasha will regenerate them on the next run."
                  : redoMale
                  ? "Male mockup will be cleared — Bipasha will regenerate it on the next run."
                  : "Female mockup will be cleared — Bipasha will regenerate it on the next run."}
              </p>
            )}

            {/* Action buttons */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className={`flex-1 rounded-lg px-5 py-3 text-sm font-semibold transition disabled:opacity-50 ${
                  hasRedoSelection
                    ? "bg-orange-700 text-white hover:bg-orange-600"
                    : "bg-[#4caf50] text-[#0a0a0a] hover:bg-[#5fc463]"
                }`}
              >
                {busy
                  ? "Saving…"
                  : hasRedoSelection
                  ? `↺ Send for redo (${[redoMale && "male", redoFemale && "female"].filter(Boolean).join(" + ")})`
                  : "✓ Approve — looks good"}
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={busy}
                className="rounded-lg border border-neutral-700 px-4 py-3 text-sm font-medium text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200 disabled:opacity-50"
                title="Skip for now — come back later (S)"
              >
                Skip
              </button>
            </div>

            <p className="mt-3 text-center text-[11px] text-neutral-600">
              Click ↺ Redo to flag · Space/→ to {hasRedoSelection ? "confirm redo" : "approve"} · S to skip
            </p>
          </article>
        )}
      </div>
    </main>
  );
}
