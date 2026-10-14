/*
  agent_runs: one row per agent run, used for status on this page.
  Run in the Supabase SQL editor (safe to re-run; the table already exists in this project):

  create table if not exists public.agent_runs (
    id uuid primary key default extensions.uuid_generate_v4(),
    agent_name text not null,
    status text not null check (status in ('running', 'completed', 'failed')),
    summary jsonb not null default '{}'::jsonb,
    started_at timestamptz not null default now(),
    completed_at timestamptz
  );

  create index if not exists agent_runs_agent_started_idx
    on public.agent_runs (agent_name, started_at desc);

  -- Only the server (service role) reads and writes this table.
  alter table public.agent_runs enable row level security;
*/

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAdminCookie } from "@/lib/admin-auth";
import { AGENTS } from "@/lib/agents/registry";
import { getLatestRuns, isStale, type AgentRun } from "@/lib/agents/runs";
import { AgentsGrid, type AgentCardData, type AgentStatus } from "./agents-grid";

export const metadata: Metadata = {
  title: "Agents · CreativeOS",
};

export default function AgentsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex-1 bg-[#0a0a0a]" />}>
      <AgentsContent />
    </Suspense>
  );
}

function statusOf(run: AgentRun | undefined): AgentStatus {
  if (!run) return "Idle";
  if (run.status === "failed" || isStale(run)) return "Error";
  if (run.status === "running") return "Running";
  return "Idle";
}

// Reads the admin cookie and live data, so it renders at request time inside Suspense.
async function AgentsContent() {
  if (!(await hasAdminCookie())) redirect("/admin/login");

  let runs = new Map<string, AgentRun>();
  let loadError: string | null = null;
  try {
    runs = await getLatestRuns();
  } catch (err) {
    console.error("[agents] couldn't load agent_runs:", err);
    loadError = err instanceof Error ? err.message : "Couldn't load agent runs.";
  }

  const cards: AgentCardData[] = AGENTS.map((agent) => {
    const run = runs.get(agent.name);
    return {
      ...agent,
      status: statusOf(run),
      stalled: run ? isStale(run) : false,
      lastRun: run
        ? {
            status: run.status,
            startedAt: run.started_at,
            completedAt: run.completed_at,
            summary: run.summary,
          }
        : null,
    };
  });

  return <AgentsGrid cards={cards} loadError={loadError} />;
}
