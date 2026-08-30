/* AgentIndexRow — one row in the all-agents eval index.
   Shows a Sparkline (recall) + RECALL / PREC / CITE metrics + chevron.
   Lists agents; does NOT rank them (no position column, no sort-by-metric). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Icon, Sparkline } from "@devdigest/ui";
import type { EvalAgentIndexRow } from "@devdigest/shared";
import { pct } from "./helpers";

function shortDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function AgentIndexRowItem({ row }: { row: EvalAgentIndexRow }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const na = t("dashboard.naValue");

  const sparkData = row.sparkline.filter((v): v is number => v != null);

  return (
    <div
      onClick={() => router.push(`/eval/${row.agent_id}`)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 80px 80px 80px 80px 80px 28px",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        gap: 12,
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
    >
      {/* Agent name + last-run metadata */}
      <div>
        <div style={{ fontWeight: 600 }}>{row.agent_name}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {row.last_run_at
            ? t("dashboard.agentRow.lastRun", { date: shortDate(row.last_run_at) })
            : t("dashboard.agentRow.neverRun")}
        </div>
      </div>

      {/* Sparkline (recall series) */}
      <div>
        {/* >= 2, not > 0: Sparkline maps x as `i / (data.length - 1)`
            (vendor/ui/charts/Sparkline.tsx:19), so a single point divides by
            zero and emits `cx="NaN"`. An agent with exactly one eval run — the
            normal state right after the first run — hits this. */}
        {sparkData.length >= 2 ? (
          <Sparkline data={sparkData} color="var(--accent)" w={60} h={20} />
        ) : (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>
        )}
      </div>

      {/* Metrics */}
      <div className="tnum" style={{ color: "var(--text-secondary)" }}>
        {pct(row.recall, na)}
      </div>
      <div className="tnum" style={{ color: "var(--text-secondary)" }}>
        {pct(row.precision, na)}
      </div>
      <div className="tnum" style={{ color: "var(--text-secondary)" }}>
        {pct(row.citation_accuracy, na)}
      </div>
      <div className="tnum" style={{ color: "var(--text-secondary)" }}>
        {row.cases_passed}/{row.cases_total}
      </div>

      {/* Chevron */}
      <div style={{ color: "var(--text-muted)" }}>
        <Icon.ChevronRight size={16} />
      </div>
    </div>
  );
}
