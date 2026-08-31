/* RunDetail — (d) per-case violations and missed as two separate labelled lists.
   Spec: "never merge violations and missed into one list" — the distinction is
   precisely what the scorer exists to draw. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalRunRecord, EvalViolation, EvalTarget } from "@devdigest/shared";
import { CitationAccuracyNote } from "@/components/citation-accuracy-note";

function pct(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  return `${(v * 100).toFixed(1)}%`;
}

function ViolationRow({ v, mustNotFlagLabel, unlistedLabel }: { v: EvalViolation; mustNotFlagLabel: string; unlistedLabel: string }) {
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        background: "var(--crit-bg, #dc262611)",
        fontSize: 12,
        color: "var(--text-secondary)",
        marginBottom: 4,
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--crit)" }}>
        {v.reason === "must_not_flag" ? mustNotFlagLabel : unlistedLabel}
      </span>
      {" — "}
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
        {v.finding.file}:{v.finding.start_line}
      </span>
      {" "}
      <span style={{ color: "var(--text-muted)" }}>{v.finding.title}</span>
    </div>
  );
}

function MissedRow({ t: target }: { t: EvalTarget }) {
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        background: "var(--warn-bg, #ca8a0411)",
        fontSize: 12,
        color: "var(--text-secondary)",
        marginBottom: 4,
      }}
    >
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
        {target.file}:{target.start_line}–{target.end_line}
      </span>
      {target.title && (
        <span style={{ color: "var(--text-muted)" }}> — {target.title}</span>
      )}
    </div>
  );
}

export function RunDetail({ record }: { record: EvalRunRecord }) {
  const t = useTranslations("eval");
  const na = t("evalsTab.naValue");

  return (
    <div style={{ padding: "12px 0" }}>
      {/* Metrics strip */}
      <div
        style={{
          display: "flex",
          gap: 16,
          fontSize: 12,
          color: "var(--text-muted)",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span>{t("evalsTab.metricRecall")}: <strong>{pct(record.recall, na)}</strong></span>
        <span>{t("evalsTab.metricPrecision")}: <strong>{pct(record.precision, na)}</strong></span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {t("evalsTab.metricCitation")}: <strong>{pct(record.citation_accuracy, na)}</strong>
          <CitationAccuracyNote />
        </span>
        <span>{t("evalsTab.metricKept")}: <strong>{record.findings_kept}</strong></span>
        <span>{t("evalsTab.metricDropped")}: <strong>{record.findings_dropped}</strong></span>
      </div>

      {/* Violations — false positives */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
          {t("evalsTab.violationsLabel")}
        </div>
        {record.violations.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evalsTab.noViolations")}</div>
        ) : (
          record.violations.map((v, i) => (
            <ViolationRow
              key={i}
              v={v}
              mustNotFlagLabel={t("evalsTab.violationMustNotFlag")}
              unlistedLabel={t("evalsTab.violationUnlisted")}
            />
          ))
        )}
      </div>

      {/* Missed — false negatives */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
          {t("evalsTab.missedLabel")}
        </div>
        {record.missed.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evalsTab.noMissed")}</div>
        ) : (
          record.missed.map((m, i) => <MissedRow key={i} t={m} />)
        )}
      </div>
    </div>
  );
}
