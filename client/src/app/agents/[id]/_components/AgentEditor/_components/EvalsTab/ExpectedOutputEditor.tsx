/* ExpectedOutputEditor — right column of the case editor modal.
   JSON textarea for expected_output (EvalTarget[]), validity badge,
   Finding skeleton button, and last-run strip. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Textarea } from "@devdigest/ui";
// Note: Textarea from @devdigest/ui accepts onChange as (value: string) => void.
import type { EvalTarget, EvalRunRecord } from "@devdigest/shared";
import { CitationAccuracyNote } from "@/components/citation-accuracy-note";

/** A blank EvalTarget template for the "+ Finding skeleton" button. */
const SKELETON_TARGET: EvalTarget = {
  kind: "must_find",
  file: "src/example.ts",
  start_line: 1,
  end_line: 1,
  source_finding_id: null,
  severity: undefined,
  category: undefined,
  title: undefined,
};

/** Format a nullable percent (0–1) for the last-run strip.
 *  Returns the supplied `na` fallback for null/undefined, or "42%" with the
 *  percent sign included, so the i18n template does not need to append "%"
 *  (which would yield "n/a%"). */
function pctStr(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  return `${(v * 100).toFixed(0)}%`;
}

interface ExpectedOutputEditorProps {
  value: string;
  onChange: (v: string) => void;
  lastRun?: EvalRunRecord | null;
}

export function ExpectedOutputEditor({ value, onChange, lastRun }: ExpectedOutputEditorProps) {
  const t = useTranslations("eval");
  const na = t("evalsTab.naValue");

  const isValid = React.useMemo(() => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, [value]);

  function insertSkeleton() {
    let current: unknown[] = [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) current = parsed;
    } catch {
      // start fresh
    }
    onChange(JSON.stringify([...current, SKELETON_TARGET], null, 2));
  }

  const durationS = lastRun?.duration_ms != null ? (lastRun.duration_ms / 1000).toFixed(1) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {t("caseEditor.expectedOutput")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: isValid ? "var(--ok)" : "var(--crit)",
              padding: "2px 6px",
              borderRadius: 4,
              background: isValid ? "var(--ok-bg, #16a34a22)" : "var(--crit-bg, #dc262622)",
            }}
          >
            {isValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
          </span>
          <Button kind="ghost" size="sm" icon="Plus" onClick={insertSkeleton}>
            {t("evalsTab.findingSkeleton")}
          </Button>
        </div>
      </div>

      {/* JSON textarea */}
      <Textarea
        value={value}
        onChange={onChange}
        placeholder="[]"
        rows={14}
        mono
      />

      {/* Last-run strip */}
      {lastRun != null && (
        <div
          style={{
            fontSize: 12,
            color: lastRun.pass ? "var(--ok)" : "var(--crit)",
            padding: "6px 10px",
            borderRadius: 6,
            background: lastRun.pass ? "var(--ok-bg, #16a34a22)" : "var(--crit-bg, #dc262622)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {lastRun.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
          </span>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <span>
            {t("caseEditor.resultSummary", {
              recall: pctStr(lastRun.recall, na),
              precision: pctStr(lastRun.precision, na),
              citation: pctStr(lastRun.citation_accuracy, na),
              duration: durationS ?? "—",
            })}
          </span>
          <CitationAccuracyNote />
        </div>
      )}
    </div>
  );
}
