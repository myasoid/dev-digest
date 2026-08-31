/* EvalsTab — agent-side Evals tab body.
   Four blocks: (a) EVAL METRICS, (b) case list, (c) case editor modal,
   (d) run history + run detail.

   Do NOT touch client/src/app/skills/.../EvalsTab/EvalsTab.tsx — that is the
   skill-side placeholder and is explicitly out of scope.
   Nothing here hard-codes owner_kind: 'agent' — stays skill-ready. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent, EvalCase } from "@devdigest/shared";
import {
  useEvalCases,
  useEvalRuns,
  useEvalDashboard,
  useEvalSuiteRunDetail,
  useCreateEvalCase,
  useUpdateEvalCase,
  useDeleteEvalCase,
  useStartEvalSuiteRun,
  useRunEvalCase,
} from "@/lib/hooks/evals";
import { EvalMetrics } from "./EvalMetrics";
import { CaseList, type CaseStatus } from "./CaseList";
import { CaseEditorModal, type CaseEditorPatch } from "./CaseEditorModal";
import { RunHistory } from "./RunHistory";

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");

  // ---- Data hooks ----
  const { data: cases = [], isLoading: casesLoading } = useEvalCases(agent.id);
  const { data: runs = [] } = useEvalRuns(agent.id);
  const { data: dashboard } = useEvalDashboard(agent.id);

  // ---- Modal state ----
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingCase, setEditingCase] = React.useState<EvalCase | null>(null);

  // ---- Detail state ----
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const { data: suiteRunDetail, isLoading: detailLoading } = useEvalSuiteRunDetail(selectedRunId);

  // ---- Mutations ----
  const createCase = useCreateEvalCase(agent.id);
  const updateCase = useUpdateEvalCase(agent.id);
  const deleteCase = useDeleteEvalCase(agent.id);
  const startSuiteRun = useStartEvalSuiteRun(agent.id);
  const runSingleCase = useRunEvalCase(agent.id);

  // ---- Derive case status from suite run history ----
  // For each case, find the most recent suite run that covers it and read pass/fail.
  // Simplified: the server returns per-case records in EvalSuiteRunDetail.
  // Here we compute status from the cases list + latest run's case records.
  const statusMap = React.useMemo((): Map<string, CaseStatus> => {
    const map = new Map<string, CaseStatus>();
    // If we have a selected run detail use it; otherwise use the most recent run.
    const detail = suiteRunDetail;
    if (detail?.cases) {
      for (const rec of detail.cases) {
        if (rec.pass === true) map.set(rec.case_id, "pass");
        else if (rec.pass === false) map.set(rec.case_id, "fail");
      }
    }
    return map;
  }, [suiteRunDetail]);

  const na = t("evalsTab.naValue");
  const subtitleMap = React.useMemo((): Map<string, string> => {
    const map = new Map<string, string>();
    const detail = suiteRunDetail;
    if (detail?.cases) {
      for (const rec of detail.cases) {
        const recall = rec.recall != null ? `${(rec.recall * 100).toFixed(0)}%` : na;
        const prec = rec.precision != null ? `${(rec.precision * 100).toFixed(0)}%` : na;
        map.set(rec.case_id, `recall ${recall} · precision ${prec}`);
      }
    }
    return map;
  }, [suiteRunDetail, na]);

  // ---- Handlers ----
  function openNewCase() {
    setEditingCase(null);
    setEditorOpen(true);
  }

  function openEditCase(c: EvalCase) {
    setEditingCase(c);
    setEditorOpen(true);
  }

  async function handleSave(patch: CaseEditorPatch) {
    let targets: unknown[] = [];
    try {
      const parsed = JSON.parse(patch.targets_json);
      if (Array.isArray(parsed)) targets = parsed;
    } catch {
      /* invalid JSON — targets stay empty */
    }

    if (editingCase) {
      await updateCase.mutateAsync({
        id: editingCase.id,
        name: patch.name,
        input_diff: patch.input_diff,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        targets: targets as any,
        unlisted: patch.unlisted,
      });
      setEditorOpen(false);
      if (patch.run_on_save) {
        runSingleCase.mutate(editingCase.id);
      }
    } else {
      const newCase = await createCase.mutateAsync({
        name: patch.name,
        input_diff: patch.input_diff,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        targets: targets as any,
        unlisted: patch.unlisted,
      });
      setEditorOpen(false);
      if (patch.run_on_save) {
        runSingleCase.mutate(newCase.id);
      }
    }
  }

  async function handleDeleteCase(caseId: string) {
    await deleteCase.mutateAsync(caseId);
  }

  // Last run record for the editing case (for the last-run strip in the modal).
  const lastRunForEditing = suiteRunDetail?.cases?.find(
    (r) => r.case_id === editingCase?.id,
  ) ?? null;

  const isRunningAll = startSuiteRun.isPending;

  if (casesLoading) {
    return (
      <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
        {t("evalsTab.loadingCases")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, padding: 24 }}>
      {/* (a) Eval metrics */}
      {dashboard && (
        <EvalMetrics dashboard={dashboard} agentId={agent.id} />
      )}

      {/* Divider */}
      {dashboard && <hr style={{ border: "none", borderTop: "1px solid var(--border)" }} />}

      {/* (b) Case list */}
      <CaseList
        cases={cases}
        statusMap={statusMap}
        subtitleMap={subtitleMap}
        runningCaseIds={new Set()}
        onRunCase={(id) => runSingleCase.mutate(id)}
        onEditCase={openEditCase}
        onDeleteCase={handleDeleteCase}
        onRunAll={() => startSuiteRun.mutate(undefined)}
        onNewCase={openNewCase}
        isRunningAll={isRunningAll}
      />

      {/* (d) Run history */}
      {runs.length > 0 && (
        <>
          <hr style={{ border: "none", borderTop: "1px solid var(--border)" }} />
          <RunHistory
            runs={runs}
            selectedId={selectedRunId}
            onSelectRun={setSelectedRunId}
            selectedRunDetail={suiteRunDetail}
            isLoadingDetail={detailLoading}
          />
        </>
      )}

      {/* (c) Case editor modal */}
      {editorOpen && (
        <CaseEditorModal
          editingCase={editingCase}
          lastRun={lastRunForEditing}
          onClose={() => setEditorOpen(false)}
          onSave={handleSave}
          onRunCase={editingCase ? () => runSingleCase.mutate(editingCase.id) : undefined}
          isSaving={createCase.isPending || updateCase.isPending}
          isRunning={runSingleCase.isPending}
        />
      )}
    </div>
  );
}
