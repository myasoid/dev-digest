/* MetricTiles — four MetricCard tiles for the per-agent eval dashboard.
   RECALL, PRECISION, CITATION ACCURACY, CASES PASSED.
   Null metrics render as n/a (criterion 6). Null deltas suppress the arrow
   rather than fabricating a delta from an empty denominator (item 3). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import { CitationAccuracyNote } from "../../../components/citation-accuracy-note";
import type { EvalDashboard, EvalTrendPoint } from "@devdigest/shared";
import { pct } from "./helpers";

/** Extract a sparkline series from the trend, filtering nulls (can't draw null points). */
function trendSeries(
  points: EvalTrendPoint[],
  key: keyof Pick<EvalTrendPoint, "recall" | "precision" | "citation_accuracy">,
): number[] {
  return points
    .map((p) => p[key])
    .filter((v): v is number => v != null);
}

export function MetricTiles({ dashboard }: { dashboard: EvalDashboard }) {
  const t = useTranslations("eval");
  const na = t("dashboard.naValue");
  const { current, delta, trend } = dashboard;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <MetricCard
          label={t("dashboard.metrics.recall")}
          value={pct(current.recall, na)}
          // null delta → undefined → MetricCard shows no arrow (criterion 6 / item 3)
          delta={delta.recall ?? undefined}
          color="var(--accent)"
          trend={trendSeries(trend, "recall")}
        />
        <MetricCard
          label={t("dashboard.metrics.precision")}
          value={pct(current.precision, na)}
          delta={delta.precision ?? undefined}
          color="var(--ok)"
          trend={trendSeries(trend, "precision")}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <MetricCard
            label={t("dashboard.metrics.citationAccuracy")}
            value={pct(current.citation_accuracy, na)}
            delta={delta.citation_accuracy ?? undefined}
            color="var(--warn, #e8a800)"
            trend={trendSeries(trend, "citation_accuracy")}
          />
          {/* Criterion 15 — mount CitationAccuracyNote wherever citation_accuracy appears */}
          <div style={{ paddingLeft: 18 }}>
            <CitationAccuracyNote />
          </div>
        </div>
        <MetricCard
          label={t("dashboard.metrics.casesPassed")}
          value={`${current.cases_passed}/${current.cases_total}`}
          color="var(--accent)"
        />
      </div>
      {/* Denominator note (item 6 — wherever recall and precision are both shown) */}
      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
        {t("evalsTab.denominatorNote")}
      </p>
    </div>
  );
}
