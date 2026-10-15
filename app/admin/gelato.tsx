"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CreateProductResponse } from "../api/gelato/create-product/route";
import type { SyncStatusResponse } from "../api/gelato/sync-status/route";

async function sendToGelato(assetId: string): Promise<CreateProductResponse> {
  try {
    const res = await fetch("/api/gelato/create-product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId }),
    });
    const body = (await res.json().catch(() => null)) as CreateProductResponse | null;
    if (body) return body;
    return { success: false, error: `Request failed (HTTP ${res.status}).` };
  } catch {
    return { success: false, error: "Couldn't reach the server." };
  }
}

function ProductLink({ productId, url }: { productId: string; url: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[#7bd67f]">
      ✓
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-[#a5e8a8]"
        >
          Gelato product ↗
        </a>
      ) : (
        <span title={productId}>On Gelato</span>
      )}
    </span>
  );
}

// Shown on rows already sent to Gelato.
export function GelatoStatus({
  productId,
  url,
  status,
}: {
  productId: string | null;
  url: string | null;
  status: string | null;
}) {
  if (status === "error") return <span className="text-xs text-red-300">Gelato error</span>;
  if (!productId) return null;
  return <ProductLink productId={productId} url={url} />;
}

export function GelatoButton({ assetId, retry = false }: { assetId: string; retry?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [result, setResult] = useState<{ productId: string; url: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    const res = await sendToGelato(assetId);
    if (res.success) {
      setResult({ productId: res.gelatoProductId, url: res.productUrl });
      setState("done");
      router.refresh();
    } else {
      setError(res.error);
      setState("idle");
    }
  }

  if (state === "done" && result) return <ProductLink productId={result.productId} url={result.url} />;

  return (
    <>
      {error && (
        <span role="alert" className="max-w-[260px] text-left text-[11px] text-red-400">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        className="whitespace-nowrap rounded-md border border-sky-800 px-3 py-1 text-xs font-medium text-sky-300 transition hover:bg-sky-950/60 disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : retry ? "Retry Gelato" : "→ Gelato"}
      </button>
    </>
  );
}

// Asks Gelato about every product still pending and marks the finished ones active.
export function SyncGelatoStatusButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "error"; text: string } | null>(null);

  async function sync() {
    setSyncing(true);
    setMessage(null);
    let body: SyncStatusResponse | null = null;
    let httpStatus = 0;
    try {
      const res = await fetch("/api/gelato/sync-status", { method: "POST" });
      httpStatus = res.status;
      body = (await res.json().catch(() => null)) as SyncStatusResponse | null;
    } catch {
      setMessage({ tone: "error", text: "Couldn't reach the server." });
      setSyncing(false);
      return;
    }

    if (body && "synced" in body) {
      const parts = [`${body.synced} updated to active`];
      if (body.failed) parts.push(`${body.failed} failed on Gelato — retry from the table`);
      if (body.stillPending) parts.push(`${body.stillPending} still pending`);
      const text = `${parts.join(", ")}.${body.warning ? ` ${body.warning}` : ""}`;
      setMessage({ tone: body.failed ? "error" : "done", text });
      if (body.synced || body.failed) router.refresh();
    } else {
      setMessage({ tone: "error", text: body?.error ?? `Sync failed (HTTP ${httpStatus}).` });
    }
    setSyncing(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        className="rounded-lg border border-sky-800 px-3 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-950/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {syncing ? "Syncing…" : "Sync Gelato Status"}
      </button>
      {message && (
        <span
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-sm ${message.tone === "done" ? "text-[#7bd67f]" : "text-red-300"}`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

type BulkState = "idle" | "running" | "stopping" | "paused";

// Sends every dalle_done design to Gelato one at a time.
export function BulkGelatoButton({ assetIds }: { assetIds: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<BulkState>("idle");
  const [queue, setQueue] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<{ tone: "done" | "error" | "info"; text: string } | null>(null);
  const stopRequested = useRef(false);

  // Leaving the page ends the run after the design in progress.
  useEffect(() => () => {
    stopRequested.current = true;
  }, []);

  async function runFrom(pending: string[], counts: { done: number; skipped: number }) {
    stopRequested.current = false;
    setState("running");
    setMessage(null);

    let remaining = pending;
    let sent = counts.done;
    const skippedCount = counts.skipped;

    while (remaining.length > 0 && !stopRequested.current) {
      const [assetId, ...rest] = remaining;
      const res = await sendToGelato(assetId);

      if (!res.success) {
        setQueue(remaining);
        setState("paused");
        setMessage({ tone: "error", text: res.error });
        router.refresh();
        return;
      }

      sent++;
      setDone(sent);
      remaining = rest;
      setQueue(remaining);
      router.refresh();
    }

    setState("idle");
    setMessage(
      remaining.length === 0
        ? {
            tone: "done",
            text: `All done! ${sent} designs sent to Gelato${skippedCount ? `, ${skippedCount} skipped` : ""}.`,
          }
        : { tone: "info", text: `Stopped. ${sent} designs sent to Gelato this run.` },
    );
  }

  function start() {
    if (assetIds.length === 0) return;
    if (
      !window.confirm(
        `Send all ${assetIds.length} completed (dalle_done) designs to Gelato? Each one creates a product in your Gelato store. You can stop at any time.`,
      )
    ) {
      return;
    }
    setDone(0);
    setSkipped(0);
    setTotal(assetIds.length);
    void runFrom(assetIds, { done: 0, skipped: 0 });
  }

  function stop() {
    stopRequested.current = true;
    if (state === "paused") {
      setState("idle");
      setMessage({ tone: "info", text: `Stopped. ${done} designs sent to Gelato this run.` });
    } else {
      setState("stopping");
    }
  }

  function skip() {
    const next = skipped + 1;
    setSkipped(next);
    void runFrom(queue.slice(1), { done, skipped: next });
  }

  const progress = `${done + skipped} of ${total}`;
  const active = state === "running" || state === "stopping";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "idle" && (
        <button
          type="button"
          onClick={start}
          disabled={assetIds.length === 0}
          className="rounded-lg border border-sky-800 px-3 py-2 text-sm font-medium text-sky-300 transition hover:bg-sky-950/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Approve all completed ({assetIds.length})
        </button>
      )}
      {active && (
        <>
          <span
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-lg border border-sky-800 bg-sky-950/40 px-3 py-2 text-sm text-sky-300"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" aria-hidden />
            {state === "stopping" ? `Stopping after current design… (${progress})` : `Sending to Gelato… (${progress})`}
          </span>
          {state === "running" && (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-300 transition hover:border-red-800 hover:text-red-300"
            >
              Stop
            </button>
          )}
        </>
      )}
      {state === "paused" && (
        <>
          <button
            type="button"
            onClick={() => void runFrom(queue, { done, skipped })}
            className="rounded-lg bg-[#c9a84c] px-3 py-2 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#d8ba62]"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={skip}
            className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-300 transition hover:border-[#c9a84c] hover:text-[#c9a84c]"
          >
            Skip this design
          </button>
          <button
            type="button"
            onClick={stop}
            className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-300 transition hover:border-red-800 hover:text-red-300"
          >
            Stop
          </button>
        </>
      )}
      {message && (
        <p
          role={message.tone === "error" ? "alert" : undefined}
          className={`w-full text-sm ${
            message.tone === "done" ? "text-[#7bd67f]" : message.tone === "error" ? "text-red-300" : "text-neutral-400"
          }`}
        >
          {message.text}
          {state === "paused" && ` (${progress} so far.)`}
        </p>
      )}
    </div>
  );
}
