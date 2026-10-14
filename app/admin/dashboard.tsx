"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { assignAssetToDesigner } from "./actions";

export type AdminAsset = {
  id: string;
  filename: string;
  god: string | null;
  country: string | null;
  size: string | null;
  status: string;
  collectionId: string | null;
  collectionName: string;
  designer: { id: string; name: string } | null;
};

type Collection = { id: string; name: string };
type Designer = { id: string; name: string; speciality: string | null };

const STATUS_STYLES: Record<string, string> = {
  not_started: "border-neutral-700 bg-neutral-800/60 text-neutral-300",
  in_progress: "border-sky-800 bg-sky-950/60 text-sky-300",
  submitted: "border-violet-800 bg-violet-950/60 text-violet-300",
  approved: "border-[#c9a84c]/60 bg-[#c9a84c]/15 text-[#e2c977]",
  rejected: "border-red-900 bg-red-950/60 text-red-300",
};

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.not_started
      }`}
    >
      {formatStatus(status)}
    </span>
  );
}

const selectClass =
  "rounded-lg border border-neutral-700 bg-[#111] px-3 py-2 text-sm text-neutral-200 outline-none focus:border-[#c9a84c] focus:ring-1 focus:ring-[#c9a84c]";

export function AdminDashboard({
  projectName,
  assets,
  collections,
  designers,
}: {
  projectName: string;
  assets: AdminAsset[];
  collections: Collection[];
  designers: Designer[];
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [assigning, setAssigning] = useState<AdminAsset | null>(null);

  const stats = useMemo(() => {
    const count = (status: string) => assets.filter((a) => a.status === status).length;
    return [
      { label: "Total designs", value: assets.length, filter: "all" },
      { label: "Not started", value: count("not_started"), filter: "not_started" },
      { label: "In progress", value: count("in_progress"), filter: "in_progress" },
      { label: "Approved", value: count("approved"), filter: "approved" },
    ];
  }, [assets]);

  const statuses = useMemo(() => {
    const known = ["not_started", "in_progress", "submitted", "approved", "rejected"];
    const present = assets.map((a) => a.status).filter((s) => !known.includes(s));
    return [...known, ...new Set(present)];
  }, [assets]);

  const filtered = assets.filter(
    (a) =>
      (statusFilter === "all" || a.status === statusFilter) &&
      (collectionFilter === "all" || a.collectionId === collectionFilter),
  );

  return (
    <main className="min-h-screen flex-1 bg-[#0a0a0a] text-neutral-200">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a84c]">
            CreativeOS Admin
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-white">{projectName}</h1>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              onClick={() => setStatusFilter(stat.filter)}
              className={`rounded-xl border bg-[#111] p-4 text-left transition hover:border-[#c9a84c]/70 ${
                statusFilter === stat.filter ? "border-[#c9a84c]" : "border-neutral-800"
              }`}
            >
              <div className="text-3xl font-semibold tabular-nums text-[#c9a84c]">
                {stat.value}
              </div>
              <div className="mt-1 text-sm text-neutral-400">{stat.label}</div>
            </button>
          ))}
        </section>

        <section className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={selectClass}
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {formatStatus(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Collection
            <select
              value={collectionFilter}
              onChange={(e) => setCollectionFilter(e.target.value)}
              className={selectClass}
            >
              <option value="all">All collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="ml-auto text-sm text-neutral-500">
            Showing {filtered.length} of {assets.length}
          </p>
        </section>

        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-[#111] text-xs uppercase tracking-wider text-[#c9a84c]">
              <tr>
                <th className="px-4 py-3 font-semibold">Filename</th>
                <th className="px-4 py-3 font-semibold">God</th>
                <th className="px-4 py-3 font-semibold">Country</th>
                <th className="px-4 py-3 font-semibold">Size</th>
                <th className="px-4 py-3 font-semibold">Collection</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Designer</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/80">
              {filtered.map((asset) => (
                <tr key={asset.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 font-mono text-xs text-neutral-300">
                    {asset.filename}
                  </td>
                  <td className="px-4 py-2.5">{asset.god ?? "—"}</td>
                  <td className="px-4 py-2.5">{asset.country ?? "—"}</td>
                  <td className="px-4 py-2.5">{asset.size ?? "—"}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{asset.collectionName}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={asset.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    {asset.designer ? (
                      asset.designer.name
                    ) : (
                      <span className="text-neutral-600">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setAssigning(asset)}
                      className="whitespace-nowrap rounded-md border border-[#c9a84c]/50 px-3 py-1 text-xs font-medium text-[#c9a84c] transition hover:bg-[#c9a84c] hover:text-[#0a0a0a]"
                    >
                      {asset.designer ? "Reassign" : "Assign to Designer"}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-neutral-500">
                    No designs match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {assigning && (
        <AssignModal
          asset={assigning}
          designers={designers}
          onClose={() => setAssigning(null)}
        />
      )}
    </main>
  );
}

function AssignModal({
  asset,
  designers,
  onClose,
}: {
  asset: AdminAsset;
  designers: Designer[];
  onClose: () => void;
}) {
  const [designerId, setDesignerId] = useState(asset.designer?.id ?? designers[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await assignAssetToDesigner(asset.id, designerId);
      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={() => !pending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-neutral-800 bg-[#111] p-6 shadow-2xl"
      >
        <h2 id="assign-title" className="text-lg font-semibold text-white">
          Assign to designer
        </h2>
        <p className="mt-1 break-all font-mono text-xs text-[#c9a84c]">{asset.filename}</p>

        {designers.length === 0 ? (
          <p className="mt-5 rounded-lg border border-neutral-800 bg-[#0a0a0a] p-4 text-sm text-neutral-400">
            There are no active designers yet. Add one to the designers table first.
          </p>
        ) : (
          <label className="mt-5 flex flex-col gap-1 text-xs text-neutral-400">
            Designer
            <select
              value={designerId}
              onChange={(e) => setDesignerId(e.target.value)}
              disabled={pending}
              autoFocus
              className={selectClass}
            >
              {designers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.speciality ? ` — ${d.speciality}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm text-neutral-300 transition hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !designerId || designerId === asset.designer?.id}
            className="rounded-lg bg-[#c9a84c] px-4 py-2 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#d8ba62] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Assigning…" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
