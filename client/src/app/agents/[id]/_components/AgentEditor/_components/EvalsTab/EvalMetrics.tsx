/* EvalMetrics — (a) EVAL METRICS block: four MetricCard tiles + dashboard link.
   Fed by EvalDashboard.current + .delta.
   Criterion 6: render null metrics as "n/a", never "0%".
   Criterion 15: mount CitationAccuracyNote next to citation_accuracy. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import { CitationAccuracyNote } from "@/components/citation-accuracy-note";
import type { EvalDashboard } from "@devdigest/shared";

/** Format a nullable ratio (0–1) as a percentage string, or the supplied fallback. */
function pct(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  return `${(v * 100).toFixed(1)}%`;
}

export function EvalMetrics({
  dashboard,
  agentId,
}: {
  dashboard: EvalDashboard;
  agentId: string;
}) {
  const t = useTranslations("eval");
  const { current, delta } = dashboard;
  const na = t("evalsTab.naValue");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {t("evalsTab.metricsTitle")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {t("evalsTab.metricsSubtitle")}
          </div>
        </div>
        <a
          href={`/eval/${agentId}`}
          style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
        >
          {t("dashboard.configure")}
        </a>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <MetricCard
          label={t("dashboard.metrics.recall")}
          value={pct(current.recall, na)}
          delta={delta.recall ?? undefined}
        />
        <MetricCard
          label={t("dashboard.metrics.precision")}
          value={pct(current.precision, na)}
          delta={delta.precision ?? undefined}
        />
        <div style={{ flex: 1, position: "relative" }}>
          <MetricCard
            label={t("dashboard.metrics.citationAccuracy")}
            value={pct(current.citation_accuracy, na)}
            delta={delta.citation_accuracy ?? undefined}
          />
          {/* CitationAccuracyNote overlaid at the top-right of the tile (criterion 15) */}
          <span style={{ position: "absolute", top: 18, right: 18 }}>
            <CitationAccuracyNote />
          </span>
        </div>
        <MetricCard
          label={t("evalsTab.casesPassed")}
          value={`${current.cases_passed}/${current.cases_total}`}
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
        {t("evalsTab.denominatorNote")}
      </div>
    </div>
  );
}
