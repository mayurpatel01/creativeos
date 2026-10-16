"use client";

import { useState, useMemo } from "react";
import type { QaIssueRow } from "./page";

type Props = {
  issues: QaIssueRow[];
  failCount: number;
  warnCount: number;
  byAgent: Record<string, number>;
};

const AGENT_COLORS: Record<string, string> = {
  katrina: "#8e44ad",
  bipasha: "#e67e22",
  aisha: "#27ae60",
  manual: "#95a5a6",
};

const AGENT_LABELS: Record<string, string> = {
  katrina: "Send to Katrina",
  bipasha: "Send to Bipasha",
  aisha: "Send to Aisha",
  manual: "Fix manually",
};

const ISSUE_LABELS: Record<string, string> = {
  missing_meta_title: "Missing meta title",
  short_meta_title: "Meta title too short",
  long_meta_title: "Meta title too long",
  missing_meta_description: "Missing meta description",
  short_meta_description: "Meta description too short",
  long_meta_description: "Meta description too long",
  missing_h1: "No H1 tag",
  multiple_h1: "Multiple H1 tags",
  missing_og_title: "Missing og:title",
  missing_og_description: "Missing og:description",
  missing_og_image: "Missing og:image",
  missing_canonical: "No canonical URL",
  missing_product_schema: "No Product schema (JSON-LD)",
  images_missing_alt: "Images missing alt text",
  missing_mockup_male: "Male mockup missing",
  missing_mockup_female: "Female mockup missing",
};

export function QaClient({ issues, failCount, warnCount, byAgent }: Props) {
  const [filter, setFilter] = useState<"all" | "fail" | "warn" | "katrina" | "bipasha" | "aisha" | "manual">("all");
  const [flagging, setFlagging] = useState<Set<string>>(new Set());
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (filter === "all") return issues;
    if (filter === "fail" || filter === "warn") return issues.filter(i => i.severity === filter);
    return issues.filter(i => i.owner_agent === filter);
  }, [issues, filter]);

  // Group by slug
  const grouped = useMemo(() => {
    const map = new Map<string, QaIssueRow[]>();
    for (const issue of filtered) {
      const list = map.get(issue.slug) ?? [];
      list.push(issue);
      map.set(issue.slug, list);
    }
    return Array.from(map.entries()).sort(([, a], [, b]) => {
      const aFails = a.filter(i => i.severity === "fail").length;
      const bFails = b.filter(i => i.severity === "fail").length;
      return bFails - aFails;
    });
  }, [filtered]);

  async function flagIssues(issueIds: string[]) {
    setFlagging(prev => new Set([...prev, ...issueIds]));
    try {
      await fetch("/api/qa/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds }),
      });
      setFlagged(prev => new Set([...prev, ...issueIds]));
    } finally {
      setFlagging(prev => {
        const next = new Set(prev);
        issueIds.forEach(id => next.delete(id));
        return next;
      });
    }
  }

  const totalPages = new Set(issues.map(i => i.slug)).size;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#ededed", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #1f1f1f", padding: "24px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.3px" }}>
            QA Audit
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
            Meera · Live page checks across hindutee.com
          </p>
        </div>
        <a
          href="/agents"
          style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", background: "#1a1a1a", padding: "6px 14px", borderRadius: 6, border: "1px solid #2a2a2a" }}
        >
          ← Agents
        </a>
      </div>

      {/* Summary tiles */}
      <div style={{ padding: "24px 32px", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "Pages audited", value: totalPages, color: "#3b82f6" },
          { label: "Failures", value: failCount, color: "#ef4444" },
          { label: "Warnings", value: warnCount, color: "#f59e0b" },
          { label: "→ Katrina", value: byAgent.katrina, color: AGENT_COLORS.katrina },
          { label: "→ Bipasha", value: byAgent.bipasha, color: AGENT_COLORS.bipasha },
          { label: "→ Aisha", value: byAgent.aisha, color: AGENT_COLORS.aisha },
          { label: "Manual", value: byAgent.manual, color: AGENT_COLORS.manual },
        ].map(tile => (
          <div key={tile.label} style={{
            background: "#141414", border: "1px solid #1f1f1f", borderRadius: 10,
            padding: "14px 20px", minWidth: 110,
          }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: tile.color }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{tile.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ padding: "0 32px 20px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["all", "fail", "warn", "katrina", "bipasha", "aisha", "manual"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              border: filter === f ? "1px solid #3b82f6" : "1px solid #2a2a2a",
              background: filter === f ? "#1e3a5f" : "#141414",
              color: filter === f ? "#93c5fd" : "#9ca3af",
            }}
          >
            {f === "all" ? "All issues" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Issue list */}
      <div style={{ padding: "0 32px 48px" }}>
        {grouped.length === 0 && (
          <div style={{ textAlign: "center", padding: "64px 0", color: "#4b5563" }}>
            {issues.length === 0
              ? "No open issues — run Meera from the Agents page to audit live pages."
              : "No issues match this filter."}
          </div>
        )}

        {grouped.map(([slug, slugIssues]) => {
          const fails = slugIssues.filter(i => i.severity === "fail");
          const warns = slugIssues.filter(i => i.severity === "warn");
          const pageUrl = slugIssues[0]?.url;

          // Group issues by owner_agent for batch flagging
          const byOwner = slugIssues.reduce<Record<string, QaIssueRow[]>>((acc, issue) => {
            (acc[issue.owner_agent] ??= []).push(issue);
            return acc;
          }, {});

          return (
            <div key={slug} style={{
              background: "#111", border: "1px solid #1f1f1f", borderRadius: 10,
              marginBottom: 12, overflow: "hidden",
            }}>
              {/* Page header */}
              <div style={{
                padding: "14px 18px", background: "#141414",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {fails.length > 0 && (
                      <span style={{ background: "#7f1d1d", color: "#fca5a5", fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                        {fails.length} fail{fails.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {warns.length > 0 && (
                      <span style={{ background: "#78350f", color: "#fcd34d", fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                        {warns.length} warn{warns.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    /products/{slug}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                  {/* Smart routing buttons — one per owner_agent present */}
                  {Object.entries(byOwner).map(([agent, agentIssues]) => {
                    const ids = agentIssues.map(i => i.id);
                    const allFlagged = ids.every(id => flagged.has(id));
                    const anyFlagging = ids.some(id => flagging.has(id));
                    if (agent === "manual") {
                      return (
                        <a
                          key={agent}
                          href={pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 11, padding: "4px 12px", borderRadius: 6, cursor: "pointer",
                            border: `1px solid #2a2a2a`,
                            background: "#1a1a1a", color: AGENT_COLORS.manual,
                            textDecoration: "none",
                          }}
                        >
                          View page ↗
                        </a>
                      );
                    }
                    return (
                      <button
                        key={agent}
                        onClick={() => flagIssues(ids)}
                        disabled={anyFlagging || allFlagged}
                        style={{
                          fontSize: 11, padding: "4px 12px", borderRadius: 6, cursor: allFlagged ? "default" : "pointer",
                          border: `1px solid ${allFlagged ? "#2a2a2a" : AGENT_COLORS[agent]}`,
                          background: allFlagged ? "#1a1a1a" : "transparent",
                          color: allFlagged ? "#4b5563" : AGENT_COLORS[agent],
                          opacity: anyFlagging ? 0.5 : 1,
                        }}
                      >
                        {allFlagged ? "✓ Flagged" : anyFlagging ? "…" : AGENT_LABELS[agent]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Issues list */}
              <div>
                {slugIssues.map((issue, idx) => (
                  <div key={issue.id} style={{
                    padding: "10px 18px",
                    borderTop: idx === 0 ? "none" : "1px solid #1a1a1a",
                    display: "flex", alignItems: "flex-start", gap: 12,
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, marginTop: 1, flexShrink: 0,
                      background: issue.severity === "fail" ? "#7f1d1d" : "#78350f",
                      color: issue.severity === "fail" ? "#fca5a5" : "#fcd34d",
                    }}>
                      {issue.severity.toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {ISSUE_LABELS[issue.issue_type] ?? issue.issue_type}
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{issue.details}</div>
                    </div>
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 10, flexShrink: 0, marginTop: 1,
                      background: "#1a1a1a", color: AGENT_COLORS[issue.owner_agent] ?? "#6b7280",
                      border: `1px solid ${AGENT_COLORS[issue.owner_agent] ?? "#2a2a2a"}22`,
                    }}>
                      {issue.owner_agent}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
