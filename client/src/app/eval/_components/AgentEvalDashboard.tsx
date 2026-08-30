/* AgentEvalDashboard — body for /eval/[agentId] (per-agent detail).
   Header + regression alert + three metric tiles + metric trend + recent runs.
   Screenshot 4. Compare modal opens from checkbox selection in RecentRunsTable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { Skeleton, Button } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { useAgent } from "../../../lib/hooks/agents";
import { useEvalDashboard, useEvalRuns, useStartEvalSuiteRun } from "../../../lib/hooks/evals";
import { MetricTiles } from "./MetricTiles";
import { MetricTrend } from "./MetricTrend";
import { RecentRunsTable } from "./RecentRunsTable";
import { RegressionAlert } from "./RegressionAlert";

export function AgentEvalDashboard() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { agentId } = useParams<{ agentId: string }>();

  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const { data: dashboard, isLoading: dashLoading } = useEvalDashboard(agentId);
  const { data: runs, isLoading: runsLoading } = useEvalRuns(agentId);
  const startRun = useStartEvalSuiteRun(agentId);

  const isLoading = agentLoading || dashLoading;
  const isRunning =
    startRun.isPending ||
    (runs ?? []).some((r) => r.status === "running");

  const agentName = agent?.name ?? "Agent";

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: agentName },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "28px 32px", maxWidth: 960, margin: "0 auto" }}>
        {/* Back link — plan specifies "‹ All agents" */}
        <button
          type="button"
          onClick={() => router.push("/eval")}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 20,
            padding: 0,
          }}
        >
          ‹ {t("dashboard.allAgentsLink")}
        </button>

        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={28} width={240} />
            <div style={{ display: "flex", gap: 14 }}>
              <Skeleton height={90} />
              <Skeleton height={90} />
              <Skeleton height={90} />
              <Skeleton height={90} />
            </div>
            <Skeleton height={180} />
          </div>
        ) : (
          <>
            {/* Header: agent name, run count summary, Run eval button */}
            <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{agentName}</h1>
                {dashboard && (
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                    {t("dashboard.casesSummary", {
                      count: dashboard.cases_total,
                      runs: dashboard.trend.length,
                    })}
                  </p>
                )}
              </div>
              <Button
                kind="primary"
                size="sm"
                icon="Play"
                disabled={isRunning}
                onClick={() => startRun.mutate(undefined)}
              >
                {isRunning
                  ? t("dashboard.running")
                  : t("dashboard.runEval", { count: dashboard?.cases_total ?? 0 })}
              </Button>
            </div>

            {/* Regression alert — straight from EvalDashboard.alert */}
            <RegressionAlert alert={dashboard?.alert ?? null} />

            {/* Four metric tiles */}
            {dashboard ? (
              <MetricTiles dashboard={dashboard} />
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                {t("dashboard.configure")}
              </p>
            )}

            {/* Metric trend — case_set_revision now on each EvalTrendPoint */}
            {dashboard && dashboard.trend.length > 0 && (
              <MetricTrend trend={dashboard.trend} />
            )}

            {/* Recent runs with per-row checkboxes */}
            {!runsLoading && runs ? (
              <RecentRunsTable runs={runs} />
            ) : (
              <Skeleton height={120} />
            )}

            {/* Link to the agent's eval cases */}
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => router.push(`/agents/${agentId}?tab=evals`)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent)",
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {t("dashboard.configure")}
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
