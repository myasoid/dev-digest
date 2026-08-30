/* MetricTrend — LineChart + legend for the per-agent eval dashboard.
   Breaks the trend line where case_set_revision changes (criterion 11).
   Null metrics produce a segment break rather than plotting 0 (criterion 6).
   Uses the vendored LineChart (no new dependency). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { LineChart, type ChartSeries } from "@devdigest/ui";
import { CitationAccuracyNote } from "../../../components/citation-accuracy-note";
import type { EvalTrendPoint } from "@devdigest/shared";

/**
 * Split trend points into contiguous segments where `case_set_revision` is
 * constant. Each segment becomes its own chart to draw a visible gap at the
 * boundary (criterion 11). A null metric value within a segment further splits
 * it so we never plot a fabricated 0 for an empty denominator (criterion 6).
 *
 * Option (a): null → segment break (gap), not filtered out. A gap is more
 * honest than closing it — the viewer sees that a run produced no data here
 * rather than inferring the metrics dropped to zero.
 */
function buildSegments(points: EvalTrendPoint[]): EvalTrendPoint[][] {
  if (!points.length) return [];

  const segments: EvalTrendPoint[][] = [];
  let current: EvalTrendPoint[] = [];
  let currentRevision = points[0]!.case_set_revision;

  for (const p of points) {
    // Break on case_set_revision change (criterion 11)
    if (p.case_set_revision !== currentRevision) {
      if (current.length) segments.push(current);
      current = [];
      currentRevision = p.case_set_revision;
    }

    // Break on any null metric — gap rather than fabricated 0 (criterion 6)
    const hasNull =
      p.recall == null || p.precision == null || p.citation_accuracy == null;
    if (hasNull && current.length) {
      segments.push(current);
      current = [];
    }
    // Skip null-metric points entirely — they cause a gap, not a 0 plot
    if (!hasNull) {
      current.push(p);
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

function seriesFor(
  points: EvalTrendPoint[],
  t: ReturnType<typeof useTranslations>,
): ChartSeries[] {
  // All values are non-null at this point (buildSegments guarantees it).
  return [
    {
      name: t("dashboard.legend.recall"),
      color: "var(--accent)",
      data: points.map((p) => p.recall!),
    },
    {
      name: t("dashboard.legend.precision"),
      color: "var(--ok)",
      data: points.map((p) => p.precision!),
    },
    {
      name: t("dashboard.legend.citation"),
      color: "var(--warn, #e8a800)",
      data: points.map((p) => p.citation_accuracy!),
    },
  ];
}

export function MetricTrend({ trend }: { trend: EvalTrendPoint[] }) {
  const t = useTranslations("eval");
  const segments = buildSegments(trend);

  if (!trend.length) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
        {t("dashboard.noRuns")}
      </p>
    );
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
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
          {t("dashboard.metricTrend")}
        </span>
        {/* Legend + citation note (criterion 15 — shown wherever citation_accuracy renders) */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--text-muted)" }}
        >
          {[
            { label: t("dashboard.legend.recall"), color: "var(--accent)" },
            { label: t("dashboard.legend.precision"), color: "var(--ok)" },
            { label: t("dashboard.legend.citation"), color: "var(--warn, #e8a800)" },
          ].map(({ label, color }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 2,
                  background: color,
                  display: "inline-block",
                  borderRadius: 1,
                }}
              />
              {label}
            </span>
          ))}
          <CitationAccuracyNote />
        </div>
      </div>

      {/* One chart per revision segment; visual divider between segments */}
      <div style={{ display: "flex", gap: 0, alignItems: "flex-end" }}>
        {segments.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("dashboard.noRuns")}
          </p>
        ) : (
          segments.map((seg, si) => (
            <React.Fragment key={si}>
              {si > 0 && (
                <div
                  style={{
                    width: 1,
                    height: 160,
                    background: "var(--border-strong)",
                    margin: "0 8px",
                    borderRadius: 1,
                    flexShrink: 0,
                  }}
                  title="Case set changed — trend line broken here"
                />
              )}
              <div style={{ flex: seg.length, minWidth: 0 }}>
                <LineChart series={seriesFor(seg, t)} h={160} yMin={0} yMax={1} />
              </div>
            </React.Fragment>
          ))
        )}
      </div>

      {/* Denominator note — shown wherever recall and precision are both visible */}
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
        {t("evalsTab.denominatorNote")}
      </p>
    </div>
  );
}
