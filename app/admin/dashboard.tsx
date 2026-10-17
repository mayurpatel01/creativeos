"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { DesignId } from "../_components/design-id";
import {
  ALL,
  ClearFiltersButton,
  COUNTRIES,
  FilterSelect,
  GODS,
  ResultCount,
  SIZES,
  toOptions,
} from "../_components/filters";
import {
  approveDesign,
  assignAssetToDesigner,
  resetDesignForRegeneration,
  unassignDesigner,
} from "./actions";
import { BulkGelatoButton, GelatoButton, GelatoStatus, SyncGelatoStatusButton } from "./gelato";
import { ImageLightbox, Thumbnail } from "./thumbnails";

export type AdminAsset = {
  id: string;
  designNumber: number | null;
  filename: string;
  god: string | null;
  country: string | null;
  size: string | null;
  status: string;
  collectionId: string | null;
  collectionName: string;
  designer: { id: string; name: string } | null;
  assignmentStatus: string | null;
  // Set when the design has an image in storage.
  filePath: string | null;
  gelatoProductId: string | null;
  gelatoProductUrl: string | null;
  gelatoStatus: string | null;
  mockupMaleUrl: string | null;
  mockupFemaleUrl: string | null;
  mockupReviewedAt: string | null;
};

type Collection = { id: string; name: string };
type Designer = { id: string; name: string; speciality: string | null };

const STATUSES = [
  "not_started",
  "dalle_done",
  "upscaled",
  "ready_for_review",
  "gelato_pending",
  "gelato_done",
  "approved",
  "rejected",
] as const;

// Statuses counted as "In progress" in the stats bar.
const IN_PROGRESS_STATUSES: string[] = ["dalle_done", "upscaled", "ready_for_review"];
const IN_PROGRESS_FILTER = "in_progress";
// Approved designs are the ones sent to Gelato.
const APPROVED_STATUSES: string[] = ["gelato_pending", "gelato_done"];
const APPROVED_FILTER = "approved_any";
// Gelato reports the product active (synced by "Sync Gelato Status").
const LIVE_FILTER = "live_in_gelato";
// Variants each Gelato product gets from the template (2 colors × 5 sizes).
// Update as color variants are added to the template.
const GELATO_VARIANTS_PER_PRODUCT = 10;
const UNASSIGNED_FILTER = "unassigned";

const STATUS_STYLES: Record<string, string> = {
  not_started: "border-neutral-700 bg-neutral-800/60 text-neutral-300",
  dalle_done: "border-blue-800 bg-blue-950/60 text-blue-300",
  upscaled: "border-indigo-800 bg-indigo-950/60 text-indigo-300",
  ready_for_review: "border-violet-800 bg-violet-950/60 text-violet-300",
  gelato_pending: "border-amber-700 bg-amber-950/60 text-amber-300",
  gelato_done: "border-[#4caf50]/60 bg-[#4caf50]/15 text-[#7bd67f]",
  approved: "border-[#4caf50]/60 bg-[#4caf50]/15 text-[#7bd67f]",
  rejected: "border-red-900 bg-red-950/60 text-red-300",
};

// Readable names for the pipeline statuses; others are title-cased.
const STATUS_LABELS: Record<string, string> = {
  not_started: "Queued",
  dalle_done: "Ready for Review",
  gelato_pending: "Pending",
  gelato_done: "Live",
};

function formatStatus(status: string) {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
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
  const [godFilter, setGodFilter] = useState(ALL);
  const [countryFilter, setCountryFilter] = useState(ALL);
  const [sizeFilter, setSizeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [collectionFilter, setCollectionFilter] = useState(ALL);
  const [designerFilter, setDesignerFilter] = useState(ALL);
  const [assigning, setAssigning] = useState<AdminAsset | null>(null);
  const [preview, setPreview] = useState<{ asset: AdminAsset; url: string } | null>(null);

  const stats = useMemo((): Array<{ label: string; value: number; filter: string; subtitle?: string }> => {
    const count = (status: string) => assets.filter((a) => a.status === status).length;
    return [
      { label: "Total designs", value: assets.length, filter: ALL },
      { label: "Not started", value: count("not_started"), filter: "not_started" },
      {
        label: "In progress",
        value: assets.filter((a) => IN_PROGRESS_STATUSES.includes(a.status)).length,
        filter: IN_PROGRESS_FILTER,
      },
      {
        label: "Approved",
        value: assets.filter((a) => APPROVED_STATUSES.includes(a.status)).length,
        filter: APPROVED_FILTER,
      },
      {
        label: "Live in Gelato",
        value: assets.filter((a) => a.gelatoStatus === "active").length,
        filter: LIVE_FILTER,
      },
      {
        label: "Est. Variants",
        value: count("gelato_done") * GELATO_VARIANTS_PER_PRODUCT,
        subtitle: "2 colors × 5 sizes × live designs",
        filter: "gelato_done",
      },
    ];
  }, [assets]);

  const statuses = useMemo(() => {
    const known: string[] = [...STATUSES];
    const present = assets.map((a) => a.status).filter((s) => !known.includes(s));
    return [...known, ...new Set(present)];
  }, [assets]);

  const filtersActive = [
    godFilter,
    countryFilter,
    sizeFilter,
    statusFilter,
    collectionFilter,
    designerFilter,
  ].some((f) => f !== ALL);

  function clearFilters() {
    setGodFilter(ALL);
    setCountryFilter(ALL);
    setSizeFilter(ALL);
    setStatusFilter(ALL);
    setCollectionFilter(ALL);
    setDesignerFilter(ALL);
  }

  const filtered = assets.filter(
    (a) =>
      (godFilter === ALL || a.god === godFilter) &&
      (countryFilter === ALL || a.country === countryFilter) &&
      (sizeFilter === ALL || a.size === sizeFilter) &&
      (statusFilter === ALL ||
        a.status === statusFilter ||
        (statusFilter === IN_PROGRESS_FILTER && IN_PROGRESS_STATUSES.includes(a.status)) ||
        (statusFilter === APPROVED_FILTER && APPROVED_STATUSES.includes(a.status)) ||
        (statusFilter === LIVE_FILTER && a.gelatoStatus === "active")) &&
      (collectionFilter === ALL || a.collectionId === collectionFilter) &&
      (designerFilter === ALL ||
        (designerFilter === UNASSIGNED_FILTER
          ? a.designer === null
          : a.designer?.id === designerFilter)),
  );

  return (
    <main className="min-h-screen flex-1 bg-[#0a0a0a] text-neutral-200">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a84c]">
              CreativeOS Admin
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-white">{projectName}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/review"
              className="rounded-lg border border-[#4caf50]/60 px-3 py-2 text-sm font-medium text-[#7bd67f] transition hover:bg-[#4caf50]/15"
            >
              Review Queue ({assets.filter((a) => a.status === "dalle_done").length} pending)
            </Link>
            {(() => {
              const mockupsPending = assets.filter(
                (a) => (a.mockupMaleUrl || a.mockupFemaleUrl) && !a.mockupReviewedAt
              ).length;
              return mockupsPending > 0 ? (
                <Link
                  href="/admin/mockups"
                  className="rounded-lg border border-[#c9a84c]/60 px-3 py-2 text-sm font-medium text-[#c9a84c] transition hover:bg-[#c9a84c]/15"
                >
                  Mockup Review ({mockupsPending} pending)
                </Link>
              ) : null;
            })()}
            <Link
              href="/agents"
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition hover:border-[#c9a84c] hover:text-[#c9a84c]"
            >
              Agents
            </Link>
            <Link
              href="/rani"
              className="flex items-center gap-2 rounded-lg border border-[#c9a84c]/50 px-3 py-2 text-sm font-medium text-[#c9a84c] transition hover:bg-[#c9a84c] hover:text-[#0a0a0a]"
            >
              <span
                aria-hidden
                className="flex h-5 w-5 items-center justify-center rounded-full bg-[#c9a84c] text-[11px] font-semibold text-[#0a0a0a]"
              >
                R
              </span>
              Ask Rani
            </Link>
          </div>
        </header>

        {/* Quick-nav to all internal pages */}
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Site navigation">
          {[
            { href: "/content",       label: "Content" },
            { href: "/qa",            label: "QA" },
            { href: "/admin/review",  label: "Review Queue" },
            { href: "/admin/mockups", label: "Mockup Review" },
            { href: "/agents",        label: "Agents" },
            { href: "/rani",          label: "Rani" },
            { href: "/reports",       label: "Priya's Reports" },
            { href: "/shop",          label: "Shop ↗", external: true },
          ].map(({ href, label, external }) => (
            <Link
              key={href}
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              className="rounded-md border border-neutral-800 bg-[#111] px-3 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-neutral-200"
            >
              {label}
            </Link>
          ))}
        </nav>

        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
                {stat.value.toLocaleString()}
              </div>
              <div className="mt-1 text-sm text-neutral-400">{stat.label}</div>
              {stat.subtitle && <div className="mt-0.5 text-[11px] text-neutral-600">{stat.subtitle}</div>}
            </button>
          ))}
        </section>

        <section className="mt-6 flex flex-wrap items-end gap-3">
          <FilterSelect
            label="God"
            allLabel="All gods"
            value={godFilter}
            options={toOptions(GODS)}
            onChange={setGodFilter}
          />
          <FilterSelect
            label="Country"
            allLabel="All countries"
            value={countryFilter}
            options={toOptions(COUNTRIES)}
            onChange={setCountryFilter}
          />
          <FilterSelect
            label="Size"
            allLabel="All sizes"
            value={sizeFilter}
            options={toOptions(SIZES)}
            onChange={setSizeFilter}
          />
          <FilterSelect
            label="Status"
            allLabel="All statuses"
            value={statusFilter}
            options={[
              { value: IN_PROGRESS_FILTER, label: "In progress (any)" },
              { value: APPROVED_FILTER, label: "Approved (sent to Gelato)" },
              { value: LIVE_FILTER, label: "Live in Gelato" },
              ...statuses.map((s) => ({ value: s, label: formatStatus(s) })),
            ]}
            onChange={setStatusFilter}
          />
          <FilterSelect
            label="Collection"
            allLabel="All collections"
            value={collectionFilter}
            options={collections.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCollectionFilter}
          />
          <FilterSelect
            label="Designer"
            allLabel="All designers"
            value={designerFilter}
            options={[
              { value: UNASSIGNED_FILTER, label: "Unassigned" },
              ...designers.map((d) => ({ value: d.id, label: d.name })),
            ]}
            onChange={setDesignerFilter}
          />
          <ClearFiltersButton disabled={!filtersActive} onClick={clearFilters} />
          <BulkGelatoButton
            assetIds={assets.filter((a) => a.status === "dalle_done" && !a.gelatoProductId).map((a) => a.id)}
          />
          <SyncGelatoStatusButton />
          <ResultCount shown={filtered.length} total={assets.length} />
        </section>

        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-[#111] text-xs uppercase tracking-wider text-[#c9a84c]">
              <tr>
                <th className="px-4 py-3 font-semibold">Preview</th>
                <th className="px-4 py-3 font-semibold">Design ID</th>
                {/* Design ID already shows the filename; the full name only fits on wide screens. */}
                <th className="hidden px-4 py-3 font-semibold 2xl:table-cell">Filename</th>
                <th className="px-4 py-3 font-semibold">God</th>
                <th className="px-4 py-3 font-semibold">Country</th>
                <th className="px-4 py-3 font-semibold">Size</th>
                <th className="px-4 py-3 font-semibold">Collection</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Designer</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/80">
              {filtered.map((asset) => (
                <tr key={asset.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2">
                    {asset.filePath ? (
                      <Thumbnail
                        filePath={asset.filePath}
                        alt={asset.filename}
                        onOpen={(url) => setPreview({ asset, url })}
                      />
                    ) : (
                      <span className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-neutral-800 text-neutral-700">
                        —
                      </span>
                    )}
                  </td>
                  <td className="max-w-[200px] px-4 py-2.5">
                    <DesignId designNumber={asset.designNumber} suggestedFilename={asset.filename} />
                  </td>
                  <td className="hidden px-4 py-2.5 font-mono text-xs text-neutral-300 2xl:table-cell">
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
                      <div className="flex items-center gap-2">
                        <span>{asset.designer.name}</span>
                        {asset.status !== "approved" && <UnassignButton asset={asset} />}
                      </div>
                    ) : (
                      <span className="text-neutral-600">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {asset.status !== "approved" && (
                      <div className="ml-auto flex max-w-[230px] flex-wrap items-center justify-end gap-2">
                        {asset.assignmentStatus === "submitted" && <ApproveButton asset={asset} />}
                        {(asset.filePath || asset.status === "dalle_done") && <RegenerateButton asset={asset} />}
                        {asset.gelatoStatus === "error" ? (
                          // Failed on Gelato, or never got there: say so, and offer it again.
                          <>
                            <GelatoStatus
                              productId={asset.gelatoProductId}
                              url={asset.gelatoProductUrl}
                              status={asset.gelatoStatus}
                            />
                            <GelatoButton assetId={asset.id} retry />
                          </>
                        ) : asset.gelatoProductId ? (
                          <GelatoStatus
                            productId={asset.gelatoProductId}
                            url={asset.gelatoProductUrl}
                            status={asset.gelatoStatus}
                          />
                        ) : (
                          asset.status === "dalle_done" && <GelatoButton assetId={asset.id} />
                        )}
                        <button
                          type="button"
                          onClick={() => setAssigning(asset)}
                          className="whitespace-nowrap rounded-md border border-[#c9a84c]/50 px-3 py-1 text-xs font-medium text-[#c9a84c] transition hover:bg-[#c9a84c] hover:text-[#0a0a0a]"
                        >
                          {asset.designer ? "Reassign" : "Assign to Designer"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-neutral-500">
                    No designs match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <ImageLightbox
          url={preview.url}
          designNumber={preview.asset.designNumber}
          filename={preview.asset.filename}
          onClose={() => setPreview(null)}
        />
      )}

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

function RegenerateButton({ asset }: { asset: AdminAsset }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function regenerate() {
    const label = asset.designNumber === null ? asset.filename : `#${asset.designNumber}`;
    if (
      !window.confirm(
        `Regenerate ${label}? This deletes the current image and sends the design back to not_started for Kajol's next run.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await resetDesignForRegeneration(asset.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error && (
        <span role="alert" className="text-[11px] text-red-400">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={regenerate}
        disabled={pending}
        className="whitespace-nowrap rounded-md border border-neutral-600 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-[#c9a84c] hover:text-[#c9a84c] disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Regenerate"}
      </button>
    </>
  );
}

function ApproveButton({ asset }: { asset: AdminAsset }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function approve() {
    const label = asset.designNumber === null ? asset.filename : `#${asset.designNumber}`;
    if (!window.confirm(`Approve ${label} (${asset.filename})?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await approveDesign(asset.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {error && (
        <span role="alert" className="text-[11px] text-red-400">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        className="whitespace-nowrap rounded-md border border-[#4caf50] bg-transparent px-3 py-1 text-xs font-medium text-[#4caf50] transition hover:bg-[#4caf50]/15 disabled:opacity-50"
      >
        {pending ? "Approving…" : "Approve"}
      </button>
    </>
  );
}

function UnassignButton({ asset }: { asset: AdminAsset }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function unassign() {
    if (!window.confirm(`Unassign ${asset.designer?.name} from ${asset.filename}?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await unassignDesigner(asset.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={unassign}
        disabled={pending}
        className="whitespace-nowrap rounded-md border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400 transition hover:border-red-800 hover:text-red-300 disabled:opacity-50"
      >
        {pending ? "Unassigning…" : "Unassign"}
      </button>
      {error && (
        <span role="alert" className="text-[11px] text-red-400">
          {error}
        </span>
      )}
    </>
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
