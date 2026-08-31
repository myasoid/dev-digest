/* AllAgentsIndex — body for /eval (all-agents eval index).
   One row per agent + RECENT EVAL RUNS · ALL AGENTS table. Screenshot 5.
   Lists agents; does NOT rank them — no sort-by-metric, no position column. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Skeleton, EmptyState } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { useEvalGlobalDashboard, useRunAllAgents } from "../../../lib/hooks/evals";
import { AgentIndexRowItem } from "./AgentIndexRow";
import { AllAgentsRuns } from "./AllAgentsRuns";
import { CitationAccuracyNote } from "../../../components/citation-accuracy-note";

export function AllAgentsIndex() {
  const t = useTranslations("eval");
  const { data, isLoading } = useEvalGlobalDashboard();
  const runAllMutation = useRunAllAgents();

  /**
   * Fire the fan-out. Deliberately does NOT gate on `data.agents.length` — the
   * server is the authority on what there is to run and answers `{ queued: 0 }`
   * when no agent has cases. An emptiness guard here made the button a silent
   * no-op that issued no request at all, which is the bug this replaced.
   */
  function handleRunAll() {
    if (runAllMutation.isPending) return;
    runAllMutation.mutate();
  }

  const result = runAllMutation.data;
  const runAllNotice = runAllMutation.isError
    ? t("dashboard.runAllFailed", {
        error:
          runAllMutation.error instanceof Error
            ? runAllMutation.error.message
            : String(runAllMutation.error),
      })
    : result
      ? result.queued > 0
        ? t("dashboard.runAllQueued", { count: result.queued })
        : t("dashboard.runAllNone")
      : null;

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard") },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "28px 32px", maxWidth: 960, margin: "0 auto" }}>
        {/* Page header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              {t("dashboard.defaultTitle")}
            </h1>
          </div>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={isLoading || runAllMutation.isPending}
            onClick={handleRunAll}
          >
            {runAllMutation.isPending ? t("dashboard.running") : t("dashboard.runAllAgents")}
          </Button>
        </div>

        {/* Outcome of the fan-out — a `queued: 0` result must say so rather
            than settling silently, which reads as "the button did nothing". */}
        {runAllNotice && (
          <div
            role="status"
            style={{
              marginTop: -12,
              marginBottom: 20,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: runAllMutation.isError ? "var(--danger)" : "var(--text-muted)",
            }}
          >
            {runAllNotice}
          </div>
        )}

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </div>
        )}

        {!isLoading && !data?.agents.length && (
          <EmptyState
            title={t("evalsTab.emptyCases")}
            body={t("dashboard.configure")}
          />
        )}

        {!isLoading && data && data.agents.length > 0 && (
          <>
            {/* Agent list — no rank, no sort-by-metric (spec: lists, does not rank) */}
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                overflow: "hidden",
                marginBottom: 32,
              }}
            >
              {/* Column headers */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 80px 80px 80px 80px 28px",
                  padding: "8px 16px",
                  background: "var(--bg-surface)",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  letterSpacing: "0.04em",
                  gap: 12,
                }}
              >
                <div>{t("dashboard.columns.agent")}</div>
                <div>{t("dashboard.columns.trend")}</div>
                <div>{t("dashboard.metrics.recall")}</div>
                <div>{t("dashboard.metrics.precision")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {t("dashboard.columns.cite")}
                  {/* Criterion 15: mount where citation_accuracy renders */}
                  <CitationAccuracyNote />
                </div>
                <div>{t("dashboard.columns.cases")}</div>
                <div />
              </div>
              {data.agents.map((row) => (
                <AgentIndexRowItem key={row.agent_id} row={row} />
              ))}
            </div>

            {/* All-agents recent runs */}
            <AllAgentsRuns runs={data.recent_runs} />
          </>
        )}
      </div>
    </AppShell>
  );
}
