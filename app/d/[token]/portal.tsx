"use client";

import { useEffect, useRef, useState } from "react";
import { saveAssignmentStatus, saveDesignerFilename, type SaveResult } from "./actions";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentStatus,
} from "./statuses";

export type DesignerAssignment = {
  id: string;
  status: AssignmentStatus;
  suggestedFilename: string;
  dallePrompt: string;
  god: string | null;
  country: string | null;
  sizeVariant: string | null;
  collectionId: string | null;
  assetStatus: string | null;
  designerFilename: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const FILENAME_DEBOUNCE_MS = 800;

const STATUS_SELECT_STYLES: Record<AssignmentStatus, string> = {
  assigned: "border-neutral-700 text-neutral-300",
  in_progress: "border-sky-800 text-sky-300",
  submitted: "border-[#c9a84c]/70 text-[#e2c977]",
};

export function DesignerPortal({
  token,
  designerName,
  assignments,
}: {
  token: string;
  designerName: string;
  assignments: DesignerAssignment[];
}) {
  const [statuses, setStatuses] = useState<Record<string, AssignmentStatus>>(() =>
    Object.fromEntries(assignments.map((a) => [a.id, a.status])),
  );

  const total = assignments.length;
  const submitted = Object.values(statuses).filter((s) => s === "submitted").length;
  const percent = total === 0 ? 0 : Math.round((submitted / total) * 100);

  return (
    <main className="min-h-screen flex-1 bg-[#0a0a0a] text-neutral-200">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a84c]">
            Designer Portal
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-white">{designerName}</h1>

          <div className="mt-6">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-neutral-400">
                <span className="font-semibold tabular-nums text-[#c9a84c]">{submitted}</span> of{" "}
                <span className="tabular-nums">{total}</span> submitted
              </span>
              <span className="tabular-nums text-neutral-500">{percent}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={submitted}
              aria-label="Designs submitted"
              className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800"
            >
              <div
                className="h-full rounded-full bg-[#c9a84c] transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </header>

        {total === 0 ? (
          <p className="mt-10 rounded-xl border border-neutral-800 bg-[#111] p-10 text-center text-neutral-400">
            You don&apos;t have any assignments yet. Check back soon.
          </p>
        ) : (
          <div className="mt-8 overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-[#111] text-xs uppercase tracking-wider text-[#c9a84c]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Design</th>
                  <th className="px-4 py-3 font-semibold">Suggested Filename</th>
                  <th className="px-4 py-3 font-semibold">DALL·E Prompt</th>
                  <th className="px-4 py-3 font-semibold">Your Filename</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/80">
                {assignments.map((assignment) => (
                  <AssignmentRow
                    key={assignment.id}
                    token={token}
                    assignment={assignment}
                    status={statuses[assignment.id]}
                    onStatusChange={(status) =>
                      setStatuses((prev) => ({ ...prev, [assignment.id]: status }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function AssignmentRow({
  token,
  assignment,
  status,
  onStatusChange,
}: {
  token: string;
  assignment: DesignerAssignment;
  status: AssignmentStatus;
  onStatusChange: (status: AssignmentStatus) => void;
}) {
  const [filename, setFilename] = useState(assignment.designerFilename);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedFilename = useRef(assignment.designerFilename);
  const saveSeq = useRef(0);

  // Only the newest save updates the indicator, so a slow earlier save can't overwrite it.
  async function runSave(save: () => Promise<SaveResult>) {
    const seq = ++saveSeq.current;
    setSaveState("saving");
    setError(null);
    let result: SaveResult;
    try {
      result = await save();
    } catch {
      result = { ok: false, error: "Couldn't reach the server." };
    }
    if (seq !== saveSeq.current) return;
    setSaveState(result.ok ? "saved" : "error");
    if (!result.ok) setError(result.error);
  }

  function flushFilename(value: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (value.trim() === lastSavedFilename.current.trim()) return;
    const previous = lastSavedFilename.current;
    lastSavedFilename.current = value;
    void runSave(async () => {
      const result = await saveDesignerFilename(token, assignment.id, value);
      // Let the next blur or edit retry a failed save.
      if (!result.ok) lastSavedFilename.current = previous;
      return result;
    });
  }

  function handleFilenameChange(value: string) {
    setFilename(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushFilename(value), FILENAME_DEBOUNCE_MS);
  }

  function handleStatusChange(next: AssignmentStatus) {
    const previous = status;
    onStatusChange(next);
    void runSave(async () => {
      const result = await saveAssignmentStatus(token, assignment.id, next);
      if (!result.ok) onStatusChange(previous);
      return result;
    });
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const design = [assignment.god, assignment.country, assignment.sizeVariant]
    .filter(Boolean)
    .join(" · ");

  return (
    <tr className="align-top hover:bg-white/[0.02]">
      <td className="px-4 py-3 font-medium whitespace-nowrap text-white">{design || "—"}</td>
      <td className="px-4 py-3 font-mono text-xs break-all text-[#c9a84c]">
        {assignment.suggestedFilename}
      </td>
      <td className="w-[38%] px-4 py-3">
        <div className="max-h-28 overflow-y-auto rounded-lg border border-neutral-800 bg-[#0a0a0a] p-2.5 text-xs leading-relaxed text-neutral-300">
          {assignment.dallePrompt || <span className="text-neutral-600">No prompt</span>}
        </div>
        {assignment.dallePrompt && <CopyButton text={assignment.dallePrompt} />}
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={filename}
          onChange={(e) => handleFilenameChange(e.target.value)}
          onBlur={(e) => flushFilename(e.target.value)}
          placeholder={assignment.suggestedFilename}
          aria-label={`Your filename for ${assignment.suggestedFilename}`}
          spellCheck={false}
          className="w-full min-w-[200px] rounded-lg border border-neutral-700 bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-neutral-600 focus:border-[#c9a84c] focus:ring-1 focus:ring-[#c9a84c]"
        />
        <SaveIndicator state={saveState} error={error} />
      </td>
      <td className="px-4 py-3">
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value as AssignmentStatus)}
          aria-label={`Status for ${assignment.suggestedFilename}`}
          className={`rounded-lg border bg-[#111] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#c9a84c] ${STATUS_SELECT_STYLES[status]}`}
        >
          {ASSIGNMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ASSIGNMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "idle") return <div className="mt-1 h-4" />;
  return (
    <div
      aria-live="polite"
      className={`mt-1 h-4 text-[11px] ${
        state === "error" ? "text-red-400" : state === "saved" ? "text-[#c9a84c]" : "text-neutral-500"
      }`}
    >
      {state === "saving" && "Saving…"}
      {state === "saved" && "Saved"}
      {state === "error" && (error ?? "Couldn't save")}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API is unavailable on plain-http origins; fall back to a hidden textarea.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="mt-2 rounded-md border border-[#c9a84c]/50 px-2.5 py-1 text-xs font-medium text-[#c9a84c] transition hover:bg-[#c9a84c] hover:text-[#0a0a0a]"
    >
      {copied ? "Copied!" : "Copy prompt"}
    </button>
  );
}
