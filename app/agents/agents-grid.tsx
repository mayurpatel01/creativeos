"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import type { AgentInfo } from "@/lib/agents/registry";
import type { KajolImage, KajolResult } from "@/lib/agents/kajol";
import type { KajolStreamEvent } from "../api/agents/kajol/route";

export type AgentStatus = "Idle" | "Running" | "Error";

export type AgentCardData = AgentInfo & {
  status: AgentStatus;
  stalled: boolean;
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    summary: Record<string, unknown>;
  } | null;
};

const STATUS_STYLES: Record<AgentStatus, string> = {
  Idle: "border-neutral-700 bg-neutral-800/60 text-neutral-300",
  Running: "border-sky-800 bg-sky-950/60 text-sky-300",
  Error: "border-red-900 bg-red-950/60 text-red-300",
};

// Per-agent accent color for avatar initials fallback
const AGENT_COLORS: Record<string, string> = {
  Kajol:   "#c9a84c",  // gold
  Rani:    "#9b59b6",  // violet
  Deepika: "#3498db",  // blue
  Bipasha: "#e67e22",  // amber
  Disha:   "#e74c3c",  // coral
  Aisha:   "#27ae60",  // green
  Priya:   "#1abc9c",  // teal
  Vidya:   "#2ecc71",  // emerald
  Katrina: "#8e44ad",  // purple
  Meera:   "#06b6d4",  // cyan
};

// Card animation variants keyed to status
const cardVariants = {
  Idle:    { boxShadow: "0 0 0px rgba(201,168,76,0)" },
  Running: { boxShadow: "0 0 18px rgba(56,189,248,0.25)" },
  Error:   { boxShadow: "0 0 18px rgba(239,68,68,0.25)" },
};

import type { TargetAndTransition } from "framer-motion";

const ringVariants: Record<AgentStatus, TargetAndTransition> = {
  Idle:    { opacity: 0, scale: 1 },
  Running: { opacity: [0.4, 0.9, 0.4], scale: [1, 1.08, 1], transition: { duration: 2, repeat: Infinity, ease: "easeInOut" } },
  Error:   { opacity: 1, x: [0, -4, 4, -4, 0], transition: { duration: 0.45, ease: "easeInOut" } },
};

// Avatar: tries /agents/<name>.png, falls back to colored initials
function AgentAvatar({ name, status }: { name: string; status: AgentStatus }) {
  const [imgErr, setImgErr] = useState(false);
  const color = AGENT_COLORS[name] ?? "#c9a84c";
  const initial = name[0].toUpperCase();

  const ringColor = status === "Running" ? "rgba(56,189,248,0.6)" : status === "Error" ? "rgba(239,68,68,0.6)" : "transparent";

  return (
    <div className="relative shrink-0">
      {/* Animated ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ border: `2px solid ${ringColor}`, borderRadius: "50%" }}
        animate={ringVariants[status]}
      />
      <div className="h-12 w-12 rounded-full overflow-hidden" style={{ border: `2px solid ${color}33` }}>
        {!imgErr ? (
          <Image
            src={`/agents/${name.toLowerCase()}.png`}
            alt={name}
            width={48}
            height={48}
            className="object-cover"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div
            className="h-full w-full flex items-center justify-center text-lg font-bold"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {initial}
          </div>
        )}
      </div>
    </div>
  );
}

// Live Realtime hook — updates card statuses without polling
function useRealtimeStatuses(
  initialStatuses: Record<string, AgentStatus>,
): Record<string, AgentStatus> {
  const [statuses, setStatuses] = useState(initialStatuses);

  useEffect(() => {
    const channel = supabase
      .channel("agent_runs_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_runs" },
        (payload) => {
          const row = payload.new as { agent_name?: string; status?: string } | null;
          if (!row?.agent_name) return;
          const agentStatus: AgentStatus =
            row.status === "running" ? "Running" :
            row.status === "failed"  ? "Error"   : "Idle";
          setStatuses((prev) => ({ ...prev, [row.agent_name!]: agentStatus }));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  return statuses;
}

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status === "Running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" aria-hidden />
      )}
      {status}
    </span>
  );
}

// Rendered in the browser's time zone; the server's would differ.
function LocalTime({ iso }: { iso: string }) {
  // Supabase timestamptz may arrive without a Z suffix; append it so
  // the Date constructor always parses as UTC, not as local time.
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(utc).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

function SummaryView({ summary }: { summary: Record<string, unknown> }) {
  const { generated, failed, errors, test, ...rest } = summary;
  const errorList = Array.isArray(errors) ? (errors as unknown[]).map(String) : [];
  const hasCounts = typeof generated === "number" || typeof failed === "number";
  const otherEntries = Object.entries(rest);

  if (!hasCounts && !errorList.length && !otherEntries.length) {
    return <p className="text-neutral-500">No summary recorded.</p>;
  }

  return (
    <div className="space-y-1.5">
      {test === true && <p className="text-xs uppercase tracking-wider text-[#c9a84c]">Test run</p>}
      {hasCounts && (
        <p>
          <span className="tabular-nums text-white">{String(generated ?? 0)}</span> generated ·{" "}
          <span className={`tabular-nums ${Number(failed) > 0 ? "text-red-300" : "text-white"}`}>
            {String(failed ?? 0)}
          </span>{" "}
          failed
        </p>
      )}
      {otherEntries.map(([key, value]) => (
        <p key={key}>
          <span className="text-neutral-500">{key}:</span>{" "}
          {typeof value === "object" ? JSON.stringify(value) : String(value)}
        </p>
      ))}
      {errorList.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-300/90">
          {errorList.slice(0, 3).map((e, i) => (
            <li key={i} className="break-words">
              {e}
            </li>
          ))}
          {errorList.length > 3 && <li className="text-neutral-500">+{errorList.length - 3} more</li>}
        </ul>
      )}
    </div>
  );
}

export function AgentsGrid({ cards, loadError }: { cards: AgentCardData[]; loadError: string | null }) {
  // Seed Realtime hook with server-rendered statuses
  const initialStatuses = Object.fromEntries(cards.map(c => [c.name, c.status]));
  const liveStatuses = useRealtimeStatuses(initialStatuses);

  // Merge live statuses into cards
  const liveCards = cards.map(c => ({ ...c, status: liveStatuses[c.name] ?? c.status }));

  return (
    <main className="min-h-screen flex-1 bg-[#0a0a0a] text-neutral-200">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a84c]">
              CreativeOS
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-white">Agents</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/content" className="text-sm text-neutral-400 transition hover:text-[#c9a84c]">
              Content ↗
            </Link>
            <Link href="/admin" className="text-sm text-neutral-400 transition hover:text-[#c9a84c]">
              ← Admin
            </Link>
          </div>
        </header>

        {loadError && (
          <p role="alert" className="mt-6 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            Couldn&apos;t load run history: {loadError}
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {liveCards.map((card) =>
            card.streaming
              ? <KajolCard key={card.name} card={card} />
              : card.runnable
                ? <RunnableCard key={card.name} card={card} />
                : <AgentCard key={card.name} card={card} />,
          )}
        </div>
      </div>
    </main>
  );
}

function CardShell({
  card,
  status,
  children,
}: {
  card: AgentCardData;
  status: AgentStatus;
  children?: React.ReactNode;
}) {
  return (
    <motion.article
      layout
      animate={cardVariants[status]}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col rounded-xl border border-neutral-800 bg-[#111] p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AgentAvatar name={card.name} status={status} />
          <div>
            <h2 className="text-lg font-semibold text-[#c9a84c]">{card.name}</h2>
            <p className="text-xs uppercase tracking-wider text-neutral-500">{card.role}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-3 text-sm text-neutral-400">{card.description}</p>

      <dl className="mt-4 space-y-3 border-t border-neutral-800 pt-4 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">Last run</dt>
          <dd className="mt-0.5 text-neutral-200">
            {card.lastRun ? (
              <>
                <LocalTime iso={card.lastRun.startedAt} />
                {card.stalled && <span className="ml-2 text-xs text-red-300">(stalled, never finished)</span>}
              </>
            ) : (
              <span className="text-neutral-500">Never run</span>
            )}
          </dd>
        </div>
        {card.lastRun && (
          <div>
            <dt className="text-xs text-neutral-500">Last run summary</dt>
            <dd className="mt-0.5 text-neutral-300">
              <SummaryView summary={card.lastRun.summary} />
            </dd>
          </div>
        )}
      </dl>

      {children}
    </motion.article>
  );
}

function AgentCard({ card }: { card: AgentCardData }) {
  return (
    <CardShell card={card} status={card.status}>
      {card.href && (
        <div className="mt-auto pt-4">
          <Link
            href={card.href}
            className="inline-block rounded-md border border-[#c9a84c]/50 px-3 py-1.5 text-xs font-medium text-[#c9a84c] transition hover:bg-[#c9a84c] hover:text-[#0a0a0a]"
          >
            Open {card.name}
          </Link>
        </div>
      )}
    </CardShell>
  );
}

// Generic card for runnable agents that return plain JSON (no streaming).
function RunnableCard({ card }: { card: AgentCardData }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ generated?: number; failed?: number; errors?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status: AgentStatus = running ? "Running" : error ? "Error" : card.status;

  async function run() {
    if (!card.apiRoute) return;
    if (!window.confirm(`Run ${card.name} now? This will use paid AI credits.`)) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(card.apiRoute, { method: "POST" });
      if (res.status === 401) { router.push("/admin/login"); return; }
      const text = await res.text();
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(text); } catch { /* non-JSON response */ }
      if (!res.ok) {
        setError(body?.error as string ?? `HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      setResult(body ?? {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <CardShell card={card} status={status}>
      {result && (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-[#0a0a0a] p-3 text-sm">
          <p>
            <span className="tabular-nums text-[#c9a84c]">{result.generated ?? 0}</span>
            <span className="text-neutral-400"> generated · </span>
            <span className={`tabular-nums ${(result.failed ?? 0) > 0 ? "text-red-300" : "text-neutral-200"}`}>
              {result.failed ?? 0}
            </span>
            <span className="text-neutral-400"> failed</span>
          </p>
          {result.errors && result.errors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-red-300/90">
              {result.errors.slice(0, 3).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>
      )}
      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || card.status === "Running"}
          className="rounded-md bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#d8ba62] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running…" : "Run now"}
        </button>
      </div>
    </CardShell>
  );
}

type LogLine = { level: "info" | "error"; message: string; at: string };

function KajolCard({ card }: { card: AgentCardData }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [testImages, setTestImages] = useState<KajolImage[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-run: calls the endpoint back to back until nothing is left.
  const [autoState, setAutoState] = useState<"idle" | "running" | "stopping" | "paused">("idle");
  const [autoGenerated, setAutoGenerated] = useState(0);
  const [autoFailed, setAutoFailed] = useState(0);
  const [autoMessage, setAutoMessage] = useState<{ tone: "done" | "error" | "info"; text: string } | null>(
    null,
  );
  const stopRequested = useRef(false);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  // Leaving the page ends the loop after the design in progress.
  useEffect(() => () => {
    stopRequested.current = true;
  }, []);

  const autoActive = autoState === "running" || autoState === "stopping";
  const status: AgentStatus = running || autoActive ? "Running" : card.status;

  async function run(mode: "full" | "test") {
    const confirmText =
      mode === "test"
        ? "Run Kajol on 1 image as a test? This will spend ~1 OpenAI credit."
        : "Run Kajol now? She'll generate 1 image with OpenAI, which uses paid credits.";
    if (!window.confirm(confirmText)) return;

    setRunning(true);
    setLines([]);
    setResult(null);
    setTestImages([]);

    try {
      const url = mode === "test" ? "/api/agents/kajol?test=1&stream=1" : "/api/agents/kajol?stream=1";
      const res = await fetch(url, { method: "POST" });
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setResult(`Error: ${body?.error ?? `request failed (${res.status})`}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          const event = JSON.parse(part) as KajolStreamEvent;
          if (event.type === "log") {
            setLines((prev) => [...prev, { level: event.level, message: event.message, at: event.at }]);
          } else if (event.type === "summary") {
            const s = event.summary;
            setResult(
              s.test && s.generated === 0 && s.failed === 0
                ? "Done: no not-started designs left to test on."
                : `Done: ${s.generated} generated, ${s.failed} failed.`,
            );
            if (s.test) setTestImages(s.images);
          } else if (event.type === "error") {
            setResult(event.busy ? "Kajol is already running." : `Error: ${event.message}`);
          }
        }
      }
    } catch (err) {
      console.error("[agents] Kajol run request failed", err);
      setResult(
        "Lost connection to the run. It may still be going; refresh in a few minutes to see the result.",
      );
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  async function autoRun(fresh: boolean) {
    if (
      fresh &&
      !window.confirm(
        "This will generate all remaining not_started designs one at a time. Each takes ~45 seconds. You can stop at any time.",
      )
    ) {
      return;
    }

    if (fresh) {
      setAutoGenerated(0);
      setAutoFailed(0);
    }
    stopRequested.current = false;
    setAutoState("running");
    setAutoMessage(null);

    let generatedTotal = fresh ? 0 : autoGenerated;
    // Failed designs stay not_started and Kajol picks the lowest-numbered one first,
    // so a design that keeps failing would otherwise loop forever.
    let consecutiveFailedRuns = 0;

    const pause = (text: string) => {
      setAutoState("paused");
      setAutoMessage({ tone: "error", text });
      router.refresh();
    };

    while (!stopRequested.current) {
      let res: Response;
      try {
        res = await fetch("/api/agents/kajol", { method: "POST" });
      } catch {
        pause("Lost connection to the server. The design in progress may still finish.");
        return;
      }

      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        pause(
          res.status === 409
            ? "Kajol is already running elsewhere. Resume once that run finishes."
            : `Run failed (HTTP ${res.status})${body?.error ? `: ${body.error}` : ""}.`,
        );
        return;
      }

      const run = (await res.json()) as KajolResult;
      generatedTotal += run.generated;
      setAutoGenerated((n) => n + run.generated);
      setAutoFailed((n) => n + run.failed);
      router.refresh();

      if (run.generated === 0 && run.failed === 0) {
        setAutoState("idle");
        setAutoMessage({ tone: "done", text: `All done! ${generatedTotal} designs generated.` });
        return;
      }

      if (run.generated === 0 && run.failed > 0) {
        consecutiveFailedRuns++;
        if (consecutiveFailedRuns >= 2) {
          pause(`The same design failed twice in a row: ${run.errors[0] ?? "unknown error"}`);
          return;
        }
      } else {
        consecutiveFailedRuns = 0;
      }
    }

    setAutoState("idle");
    setAutoMessage({ tone: "info", text: `Stopped. ${generatedTotal} designs generated this session.` });
  }

  function stopAuto() {
    stopRequested.current = true;
    if (autoState === "paused") {
      setAutoState("idle");
      setAutoMessage({ tone: "info", text: `Stopped. ${autoGenerated} designs generated this session.` });
    } else {
      setAutoState("stopping");
    }
  }

  const autoCount = `${autoGenerated} done${autoFailed > 0 ? `, ${autoFailed} failed` : ""}`;

  const showPanel = running || lines.length > 0 || result;

  return (
    <CardShell card={card} status={status}>
      {showPanel && (
        <div className="mt-4">
          <div
            ref={logRef}
            aria-live="polite"
            className="max-h-56 overflow-y-auto rounded-lg border border-neutral-800 bg-[#0a0a0a] p-3 font-mono text-[11px] leading-relaxed"
          >
            {lines.length === 0 && running && <p className="text-neutral-500">Starting…</p>}
            {lines.map((line, i) => (
              <p key={i} className={line.level === "error" ? "text-red-300" : "text-neutral-300"}>
                <span className="text-neutral-600">
                  {new Date(line.at).toLocaleTimeString(undefined, { hour12: false })}
                </span>{" "}
                {line.message}
              </p>
            ))}
          </div>
          {result && (
            <p className={`mt-2 text-sm ${result.startsWith("Done") ? "text-[#c9a84c]" : "text-red-300"}`}>
              {result}
            </p>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <button
          type="button"
          onClick={() => void run("full")}
          disabled={running || autoActive || card.status === "Running"}
          className="rounded-md bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#d8ba62] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running…" : "Run now"}
        </button>
        <button
          type="button"
          onClick={() => void run("test")}
          disabled={running || autoActive || card.status === "Running"}
          className="rounded-md border border-[#c9a84c]/50 px-4 py-2 text-sm font-medium text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Test (1 image)
        </button>

        {autoState === "idle" && (
          <button
            type="button"
            onClick={() => void autoRun(true)}
            disabled={running || card.status === "Running"}
            className="rounded-md border border-[#c9a84c]/50 px-4 py-2 text-sm font-medium text-[#c9a84c] transition hover:bg-[#c9a84c]/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Auto-run all
          </button>
        )}
        {autoActive && (
          <>
            <span
              aria-live="polite"
              className="inline-flex items-center gap-2 rounded-md border border-sky-800 bg-sky-950/40 px-4 py-2 text-sm text-sky-300"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" aria-hidden />
              {autoState === "stopping"
                ? `Stopping after current design… (${autoCount})`
                : `Running... (${autoCount})`}
            </span>
            {autoState === "running" && (
              <button
                type="button"
                onClick={stopAuto}
                className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-red-800 hover:text-red-300"
              >
                Stop
              </button>
            )}
          </>
        )}
        {autoState === "paused" && (
          <>
            <button
              type="button"
              onClick={() => void autoRun(false)}
              className="rounded-md bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#d8ba62]"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={stopAuto}
              className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-red-800 hover:text-red-300"
            >
              Stop
            </button>
          </>
        )}
      </div>

      {autoMessage && (
        <p
          role={autoMessage.tone === "error" ? "alert" : undefined}
          className={`mt-3 text-sm ${
            autoMessage.tone === "done"
              ? "text-[#c9a84c]"
              : autoMessage.tone === "error"
                ? "text-red-300"
                : "text-neutral-400"
          }`}
        >
          {autoMessage.text}
          {autoState === "paused" && ` (${autoCount} so far.)`}
        </p>
      )}

      {testImages.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#c9a84c]/30 bg-[#c9a84c]/5 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#c9a84c]">Test image</p>
          {testImages.map((image) => (
            <div key={image.filePath} className="mt-1.5">
              <p className="font-mono text-xs break-all text-neutral-400">
                {image.designNumber !== null && `#${image.designNumber} `}
                {image.filename}
              </p>
              {image.signedUrl ? (
                <a
                  href={image.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block break-all text-[#c9a84c] underline underline-offset-2 hover:text-[#e2c977]"
                >
                  Open generated image ↗
                </a>
              ) : (
                <p className="mt-0.5 text-xs text-red-300">
                  Couldn&apos;t create a viewing link. The file is at {image.filePath}.
                </p>
              )}
              <p className="mt-1 text-[11px] text-neutral-500">Link expires in 1 hour.</p>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}
