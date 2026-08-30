/* RunHistory — (d) run history + detail per case.
   Lists suite runs for this agent; on click shows EvalSuiteRunDetail with
   per-case rows including violations and missed as separate lists. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { EvalSuiteRun, EvalSuiteRunDetail } from "@devdigest/shared";
import { RunDetail } from "./RunDetail";

function pct(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  return `${(v * 100).toFixed(1)}%`;
}

function statusColor(status: EvalSuiteRun["status"]): string {
  switch (status) {
    case "succeeded": return "var(--ok)";
    case "failed": return "var(--crit)";
    case "running": return "var(--accent)";
    default: return "var(--text-muted)";
  }
}

interface RunHistoryProps {
  runs: EvalSuiteRun[];
  /** Currently selected run id — lifted to EvalsTab to avoid duplicate state. */
  selectedId: string | null;
  /** Notify parent to update selectedId and fetch detail. */
  onSelectRun: (runId: string) => void;
  selectedRunDetail?: EvalSuiteRunDetail | null;
  isLoadingDetail?: boolean;
}

export function RunHistory({ runs, selectedId, onSelectRun, selectedRunDetail, isLoadingDetail }: RunHistoryProps) {
  const t = useTranslations("eval");
  const na = t("evalsTab.naValue");

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
        {t("evalsTab.runHistoryTitle")}
      </div>

      {runs.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("evalsTab.noRunHistory")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {runs.map((run) => {
            const isSelected = selectedId === run.id;
            const durationS = run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : null;
            return (
              <div key={run.id}>
                <button
                  onClick={() => onSelectRun(run.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    background: isSelected ? "var(--bg-hover)" : "transparent",
                    transition: "background .12s",
                  }}
                >
                  {/* Status dot */}
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: statusColor(run.status),
                      flexShrink: 0,
                    }}
                  />
                  {/* Version */}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", minWidth: 40 }}>
                    v{run.inputs.agent_version}
                  </span>
                  {/* Metrics */}
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    recall {pct(run.recall, na)} · prec {pct(run.precision, na)}
                  </span>
                  {/* Cases passed */}
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {run.cases_passed}/{run.cases_total}
                  </span>
                  {/* Duration */}
                  {durationS && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
                      {durationS}
                    </span>
                  )}
                  {/* Expand chevron */}
                  <Icon.ChevronDown
                    size={14}
                    style={{
                      color: "var(--text-muted)",
                      transform: isSelected ? "rotate(180deg)" : "none",
                      transition: "transform .15s",
                    }}
                  />
                </button>

                {/* Detail panel */}
                {isSelected && (
                  <div
                    style={{
                      borderLeft: "2px solid var(--border)",
                      marginLeft: 16,
                      paddingLeft: 16,
                    }}
                  >
                    {isLoadingDetail ? (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>
                        {t("evalsTab.running")}
                      </div>
                    ) : selectedRunDetail?.cases != null ? (
                      <div>
                        {selectedRunDetail.cases.map((rec) => (
                          <div key={rec.id} style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                              {rec.case_name ?? rec.case_id}
                            </div>
                            <RunDetail record={rec} />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
