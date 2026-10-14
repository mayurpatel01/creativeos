import { getSupabaseAdmin } from "../supabase";

export type AgentRunStatus = "running" | "completed" | "failed";

export type AgentRun = {
  id: string;
  agent_name: string;
  status: AgentRunStatus;
  summary: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
};

// A "running" row older than this is treated as dead (server restarted mid-run).
export const STALE_RUN_MS = 15 * 60 * 1000;

export function isStale(run: Pick<AgentRun, "status" | "started_at">): boolean {
  return run.status === "running" && Date.now() - Date.parse(run.started_at) > STALE_RUN_MS;
}

// Run bookkeeping never fails an agent run; problems are logged and the run continues.

export async function startAgentRun(agentName: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_runs")
    .insert({ agent_name: agentName, status: "running", summary: {} })
    .select("id")
    .single();
  if (error) {
    console.error(`[${agentName}] couldn't record run start in agent_runs:`, error.message);
    return null;
  }
  return data.id;
}

export async function finishAgentRun(
  agentName: string,
  runId: string | null,
  status: Exclude<AgentRunStatus, "running">,
  summary: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;
  const { error } = await getSupabaseAdmin()
    .from("agent_runs")
    .update({ status, summary, completed_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) {
    console.error(`[${agentName}] couldn't record run result in agent_runs:`, error.message);
  }
}

// True if another server process has a live run of this agent in progress.
export async function hasActiveRun(agentName: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_runs")
    .select("id")
    .eq("agent_name", agentName)
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - STALE_RUN_MS).toISOString())
    .limit(1);
  if (error) {
    console.error(`[${agentName}] couldn't check agent_runs for an active run:`, error.message);
    return false;
  }
  return data.length > 0;
}

export async function getLatestRuns(): Promise<Map<string, AgentRun>> {
  // Newest first; the first row seen per agent is its latest run.
  const { data, error } = await getSupabaseAdmin()
    .from("agent_runs")
    .select("id, agent_name, status, summary, started_at, completed_at")
    .order("started_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`agent_runs query failed: ${error.message}`);

  const latest = new Map<string, AgentRun>();
  for (const run of data as AgentRun[]) {
    if (!latest.has(run.agent_name)) latest.set(run.agent_name, run);
  }
  return latest;
}
