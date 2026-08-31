/* RecentRunsTable — RECENT RUNS table for the per-agent eval dashboard.
   Per-row checkboxes, N selected counter, Compare button (opens CompareRunsModal).
   Null metrics render as n/a (criterion 6). */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Badge, Checkbox } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { CompareRunsModal } from "./CompareRunsModal";
import { CitationAccuracyNote } from "../../../components/citation-accuracy-note";
import { pct } from "./helpers";

function shortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StatusBadge({ run, t }: { run: EvalSuiteRun; t: ReturnType<typeof useTranslations> }) {
  if (run.status === "running") return <Badge color="var(--accent)">{t("dashboard.running")}</Badge>;
  if (run.status === "failed") return <Badge color="var(--crit)">{run.error ?? t("dashboard.fail")}</Badge>;
  return null;
}

export function RecentRunsTable({
  runs,
  sectionTitle,
}: {
  runs: EvalSuiteRun[];
  sectionTitle?: string;
}) {
  const t = useTranslations("eval");
  const na = t("dashboard.naValue");

  // Selection state for compare: max 2 runs can be selected
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Max 2 for comparison
        if (next.size < 2) next.add(id);
      }
      return next;
    });
  }

  const selectedArr = Array.from(selected);
  const canCompare = selectedArr.length === 2;

  return (
    <>
      <div>
        {/* Section header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span
            style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.06em" }}
          >
            {sectionTitle ?? t("dashboard.recentRuns")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {selected.size > 0 && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("dashboard.compareSelected", { n: selected.size })}
              </span>
            )}
            {canCompare && (
              <Button
                kind="secondary"
                size="sm"
                icon="BarChart"
                onClick={() => setCompareOpen(true)}
              >
                {t("dashboard.compareButton")}
              </Button>
            )}
          </div>
        </div>

        {runs.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</p>
        ) : (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "32px 1fr 64px 80px 80px 80px 80px 72px 80px",
                padding: "8px 14px",
                background: "var(--bg-surface)",
                borderBottom: "1px solid var(--border)",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
                gap: 8,
              }}
            >
              <div title={t("dashboard.table.select")} />
              <div>{t("dashboard.table.ranAt")}</div>
              <div>{t("dashboard.table.version")}</div>
              <div>{t("dashboard.table.recall")}</div>
              <div>{t("dashboard.table.precision")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {t("dashboard.table.citation")}
                <CitationAccuracyNote />
              </div>
              <div>{t("dashboard.table.pass")}</div>
              <div>{t("dashboard.table.cost")}</div>
              <div />
            </div>

            {/* Rows */}
            {runs.map((run) => {
              const isSelected = selected.has(run.id);
              const disableSelect = !isSelected && selected.size >= 2;
              return (
                <div
                  key={run.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px 1fr 64px 80px 80px 80px 80px 72px 80px",
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    alignItems: "center",
                    fontSize: 13,
                    background: isSelected ? "rgba(99,102,241,0.05)" : undefined,
                    gap: 8,
                  }}
                >
                  <div>
                    <Checkbox
                      checked={isSelected}
                      onChange={disableSelect ? undefined : () => toggleSelect(run.id)}
                    />
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    {shortDate(run.ran_at)}
                    <StatusBadge run={run} t={t} />
                  </div>
                  <div>
                    <Badge color="var(--text-muted)" mono>
                      v{run.inputs.agent_version}
                    </Badge>
                  </div>
                  <div className="tnum">{pct(run.recall, na)}</div>
                  <div className="tnum">{pct(run.precision, na)}</div>
                  <div className="tnum">{pct(run.citation_accuracy, na)}</div>
                  <div className="tnum">{run.cases_passed}/{run.cases_total}</div>
                  <div className="tnum" style={{ color: "var(--text-secondary)" }}>
                    {run.cost_usd != null ? `$${run.cost_usd.toFixed(3)}` : "—"}
                  </div>
                  <div />
                </div>
              );
            })}
          </div>
        )}
        {/* Denominator note (item 6 — wherever recall and precision are both shown) */}
        {runs.length > 0 && (
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            {t("evalsTab.denominatorNote")}
          </p>
        )}
      </div>

      {/* Compare modal */}
      {compareOpen && canCompare && (
        <CompareRunsModal
          runIdA={selectedArr[0]!}
          runIdB={selectedArr[1]!}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </>
  );
}
