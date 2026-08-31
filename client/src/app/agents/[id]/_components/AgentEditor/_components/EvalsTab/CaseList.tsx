/* CaseList — (b) Case list with three states: pass / fail / never run.
   Header: N/M passing, Run all evals, New eval case.
   Per-row: status icon, mono name, result subtitle, target-kind badges,
            hover-revealed Run / Edit / Delete icon buttons. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn, Button, Badge } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";

/** Last-run status for a case, derived from the suite runs history. */
export type CaseStatus = "pass" | "fail" | "never_run";

function StatusIcon({ status }: { status: CaseStatus }) {
  if (status === "pass") return <Icon.CheckCircle size={14} style={{ color: "var(--ok)" }} />;
  if (status === "fail") return <Icon.XCircle size={14} style={{ color: "var(--crit)" }} />;
  // "never_run" — dashed / muted circle using an available icon
  return <Icon.Dot size={14} style={{ color: "var(--text-muted)" }} />;
}

function KindBadge({ kind }: { kind: string }) {
  const t = useTranslations("eval");
  const label = kind === "must_find" ? t("evalsTab.kindMustFind") : t("evalsTab.kindMustNotFlag");
  const color = kind === "must_find" ? "var(--ok)" : "var(--warn)";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color,
        background: `${color}22`,
        border: `1px solid ${color}55`,
        borderRadius: 4,
        padding: "1px 5px",
        letterSpacing: "0.02em",
      }}
    >
      {label}
    </span>
  );
}

interface CaseRowProps {
  evalCase: EvalCase;
  status: CaseStatus;
  statusLabel: string;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isRunning: boolean;
}

function CaseRow({ evalCase, status, statusLabel, onRun, onEdit, onDelete, isRunning }: CaseRowProps) {
  const t = useTranslations("eval");
  const [hovered, setHovered] = React.useState(false);
  const kinds = Array.from(new Set(evalCase.targets.map((t) => t.kind)));

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 6,
        background: hovered ? "var(--bg-hover)" : "transparent",
        transition: "background .12s",
      }}
    >
      <StatusIcon status={status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {evalCase.name}
          </span>
          {kinds.map((k) => <KindBadge key={k} kind={k} />)}
          {evalCase.unlisted === "forbid" && (
            <Badge
              color="var(--text-muted)"
              bg="var(--bg-hover)"
              style={{ fontSize: 10, padding: "1px 5px" }}
            >
              {t("evalsTab.unlistedForbid")}
            </Badge>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {statusLabel}
        </div>
      </div>
      {hovered && (
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconBtn
            icon="Play"
            label={isRunning ? t("evalsTab.running") : t("evalsTab.run")}
            size={26}
            onClick={onRun}
          />
          <IconBtn icon="Edit" label={t("evalsTab.edit")} size={26} onClick={onEdit} />
          <IconBtn icon="Trash" label={t("evalsTab.delete")} size={26} danger onClick={onDelete} />
        </div>
      )}
    </div>
  );
}

interface CaseListProps {
  cases: EvalCase[];
  /** Map of case_id → last run status (computed from suite run history). */
  statusMap: Map<string, CaseStatus>;
  /** Map of case_id → result subtitle string. */
  subtitleMap: Map<string, string>;
  runningCaseIds: Set<string>;
  onRunCase: (caseId: string) => void;
  onEditCase: (evalCase: EvalCase) => void;
  onDeleteCase: (caseId: string) => void;
  onRunAll: () => void;
  onNewCase: () => void;
  isRunningAll: boolean;
}

export function CaseList({
  cases,
  statusMap,
  subtitleMap,
  runningCaseIds,
  onRunCase,
  onEditCase,
  onDeleteCase,
  onRunAll,
  onNewCase,
  isRunningAll,
}: CaseListProps) {
  const t = useTranslations("eval");

  const passing = Array.from(statusMap.values()).filter((s) => s === "pass").length;
  const total = cases.length;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {t("evalsTab.casesHeading")}
          </span>
          {total > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("evalsTab.casesPassingCount", { passing, total })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind="ghost"
            size="sm"
            icon="Play"
            disabled={isRunningAll || cases.length === 0}
            loading={isRunningAll}
            onClick={onRunAll}
          >
            {isRunningAll ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
          <Button kind="secondary" size="sm" icon="Plus" onClick={onNewCase}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {/* Case rows */}
      {cases.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "16px 0" }}>
          {t("evalsTab.emptyCases")}
        </div>
      ) : (
        <div>
          {cases.map((c) => {
            const status = statusMap.get(c.id) ?? "never_run";
            const statusLabel =
              status === "never_run"
                ? t("evalsTab.neverRun")
                : status === "pass"
                ? t("evalsTab.passed")
                : t("evalsTab.failed");
            return (
              <CaseRow
                key={c.id}
                evalCase={c}
                status={status}
                statusLabel={subtitleMap.get(c.id) ?? statusLabel}
                isRunning={runningCaseIds.has(c.id)}
                onRun={() => onRunCase(c.id)}
                onEdit={() => onEditCase(c)}
                onDelete={() => onDeleteCase(c.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
