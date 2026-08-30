/* CompareRunsModal — modal over /eval/[agentId] comparing two suite runs.
   Criteria 9, 11, 18. No new server route — uses GET /eval-runs/:id ×2
   and GET /agents/:id/versions/:version ×2. No "Promote v7" button (out of scope).
   Footer is Close only. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Skeleton } from "@devdigest/ui";
import type { EvalSuiteRunDetail } from "@devdigest/shared";
import { useEvalRunPair, useAgentVersion } from "../../../lib/hooks/evals";
import { comparability } from "./comparability";
import { PromptDiff } from "./PromptDiff";
import { CitationAccuracyNote } from "../../../components/citation-accuracy-note";
import { pct } from "./helpers";

/** Signed delta tile for a numeric metric. */
function DeltaTile({ label, oldVal, newVal, na }: {
  label: string;
  oldVal: number | null | undefined;
  newVal: number | null | undefined;
  na: string;
}) {
  const delta = oldVal != null && newVal != null ? newVal - oldVal : null;
  const up = (delta ?? 0) > 0;
  const flat = delta === 0;
  const color = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  const arrow = flat ? "" : up ? "▲" : "▼";
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {pct(oldVal, na)} → {pct(newVal, na)}
      </div>
      {delta != null && (
        <div style={{ fontSize: 13, fontWeight: 600, color, marginTop: 4 }}>
          {arrow}{Math.abs(delta * 100).toFixed(1)}pt
        </div>
      )}
    </div>
  );
}

/** Cost tile — dollar values. */
function CostTile({ label, oldVal, newVal }: {
  label: string;
  oldVal: number | null | undefined;
  newVal: number | null | undefined;
}) {
  const fmt = (v: number | null | undefined) =>
    v != null ? `$${v.toFixed(2)}` : "—";
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.04em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {fmt(oldVal)} → {fmt(newVal)}
      </div>
    </div>
  );
}

/** Banner showing the comparability verdict for the two runs. */
function ComparabilityBanner({ runA, runB, t }: {
  runA: EvalSuiteRunDetail;
  runB: EvalSuiteRunDetail;
  t: ReturnType<typeof useTranslations>;
}) {
  const result = comparability(runA.inputs, runB.inputs);

  if (result.kind === "like-for-like") return null;

  const msg =
    result.kind === "skills-changed"
      ? t("dashboard.compare.comparabilitySkillsChanged")
      : t("dashboard.compare.comparabilityCaseSetChanged");

  return (
    <div
      role="alert"
      style={{
        background: "rgba(255,180,0,0.08)",
        border: "1px solid rgba(255,180,0,0.35)",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        color: "var(--warn, #e8a800)",
        marginBottom: 20,
      }}
    >
      ⚠ {msg}
    </div>
  );
}

export function CompareRunsModal({
  runIdA,
  runIdB,
  onClose,
}: {
  runIdA: string;
  runIdB: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const na = t("dashboard.naValue");

  const { a, b } = useEvalRunPair(runIdA, runIdB);

  // Fetch agent versions for each run to diff system prompts
  const runA = a.data;
  const runB = b.data;

  const agentIdA = runA?.owner_id ?? null;
  const agentIdB = runB?.owner_id ?? null;
  const versionA = runA?.inputs.agent_version ?? null;
  const versionB = runB?.inputs.agent_version ?? null;

  const verA = useAgentVersion(agentIdA, versionA);
  const verB = useAgentVersion(agentIdB, versionB);

  const loading = a.isLoading || b.isLoading;

  const oldVersion = versionA ?? "?";
  const newVersion = versionB ?? "?";
  const title = t("dashboard.compare.title", { old: oldVersion, new: newVersion });

  return (
    <Modal
      width={780}
      title={title}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button kind="secondary" onClick={onClose}>
            {t("dashboard.compare.close")}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.compare.loading")}</p>
            <Skeleton height={80} />
            <Skeleton height={200} />
          </div>
        )}

        {!loading && runA && runB && (
          <>
            {/* Comparability warning banner */}
            <ComparabilityBanner runA={runA} runB={runB} t={t} />

            {/* Denominator note (recall vs precision) */}
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("evalsTab.denominatorNote")}
            </p>

            {/* Four delta tiles */}
            <div style={{ display: "flex", gap: 12 }}>
              <DeltaTile
                label={t("dashboard.compare.deltaRecall")}
                oldVal={runA.recall}
                newVal={runB.recall}
                na={na}
              />
              <DeltaTile
                label={t("dashboard.compare.deltaPrecision")}
                oldVal={runA.precision}
                newVal={runB.precision}
                na={na}
              />
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <DeltaTile
                  label={t("dashboard.compare.deltaCitation")}
                  oldVal={runA.citation_accuracy}
                  newVal={runB.citation_accuracy}
                  na={na}
                />
                <div style={{ marginTop: 4 }}>
                  <CitationAccuracyNote />
                </div>
              </div>
              <CostTile
                label={t("dashboard.compare.deltaCost")}
                oldVal={runA.cost_usd}
                newVal={runB.cost_usd}
              />
            </div>

            {/* System prompt diff */}
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    letterSpacing: "0.06em",
                  }}
                >
                  {t("dashboard.compare.promptDiff")}
                </span>
                <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        background: "rgba(220,50,50,0.4)",
                        borderRadius: 2,
                        marginRight: 4,
                      }}
                    />
                    {t("dashboard.compare.promptOld", { version: oldVersion })}
                  </span>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        background: "rgba(0,200,80,0.4)",
                        borderRadius: 2,
                        marginRight: 4,
                      }}
                    />
                    {t("dashboard.compare.promptNew", { version: newVersion })}
                  </span>
                </div>
              </div>

              {verA.isLoading || verB.isLoading ? (
                <Skeleton height={120} />
              ) : verA.data && verB.data ? (
                <PromptDiff
                  oldPrompt={verA.data.config.system_prompt}
                  newPrompt={verB.data.config.system_prompt}
                  identicalMessage={t("dashboard.compare.promptIdentical")}
                />
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Could not load version snapshots.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
