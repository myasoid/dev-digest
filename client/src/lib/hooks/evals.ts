/* hooks/evals.ts — React Query hooks for the eval pipeline.
   Follows the usePrReviews / usePrRuns pattern in reviews.ts.
   All data access through api.*; no direct fetch calls. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseInput,
  EvalSuiteRun,
  EvalSuiteRunDetail,
  EvalDashboard,
  EvalGlobalDashboard,
  EvalRunAllResult,
  AgentVersion,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/** Keyed by agentId. Invalidate both when any case or run changes. */
const casesKey = (agentId: string) => ["eval-cases", agentId] as const;
const runsKey = (agentId: string) => ["eval-runs", agentId] as const;
const dashboardKey = (agentId: string) => ["eval-dashboard", agentId] as const;
const suiteRunKey = (suiteRunId: string) => ["eval-suite-run", suiteRunId] as const;
const globalDashboardKey = () => ["eval-global-dashboard"] as const;
const agentVersionKey = (agentId: string, version: number) =>
  ["agent-version", agentId, version] as const;

// ---------------------------------------------------------------------------
// Case list for an agent
// ---------------------------------------------------------------------------

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentId ? casesKey(agentId) : ["eval-cases", null],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

// ---------------------------------------------------------------------------
// Suite run history for an agent (scope='suite' only, filtered server-side)
// ---------------------------------------------------------------------------

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentId ? runsKey(agentId) : ["eval-runs", null],
    queryFn: () => api.get<EvalSuiteRun[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
    // Poll while any suite run is still in progress.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? 4000 : false,
  });
}

// ---------------------------------------------------------------------------
// Detail of one suite run (EvalSuiteRun + per-case EvalRunRecord[])
// ---------------------------------------------------------------------------

export function useEvalSuiteRunDetail(suiteRunId: string | null | undefined) {
  return useQuery({
    queryKey: suiteRunId ? suiteRunKey(suiteRunId) : ["eval-suite-run", null],
    queryFn: () => api.get<EvalSuiteRunDetail>(`/eval-runs/${suiteRunId}`),
    enabled: !!suiteRunId,
    // Poll while the run is still in progress.
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 3000 : false,
  });
}

// ---------------------------------------------------------------------------
// Per-agent eval dashboard
// ---------------------------------------------------------------------------

export function useEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentId ? dashboardKey(agentId) : ["eval-dashboard", null],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

// ---------------------------------------------------------------------------
// Create an eval case from a decided finding (POST /findings/:id/eval-case)
// Returns 201 on create, 200 on idempotent hit, 422 on undecided finding.
// ---------------------------------------------------------------------------

export function useCreateEvalCaseFromFinding(agentId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCase>(`/findings/${findingId}/eval-case`),
    onSuccess: () => {
      if (agentId) {
        void qc.invalidateQueries({ queryKey: casesKey(agentId) });
        void qc.invalidateQueries({ queryKey: runsKey(agentId) });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Manually create an eval case for an agent
// ---------------------------------------------------------------------------

export type CreateEvalCaseInput = Omit<EvalCaseInput, "owner_kind" | "owner_id">;

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEvalCaseInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: casesKey(agentId) });
      void qc.invalidateQueries({ queryKey: runsKey(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Patch (update) an eval case — PATCH /eval-cases/:id
// ---------------------------------------------------------------------------

export interface UpdateEvalCaseInput {
  name?: string;
  notes?: string | null;
  targets?: EvalCase["targets"];
  unlisted?: EvalCase["unlisted"];
  input_diff?: string;
}

export function useUpdateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateEvalCaseInput & { id: string }) =>
      api.patch<EvalCase>(`/eval-cases/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: casesKey(agentId) });
      void qc.invalidateQueries({ queryKey: runsKey(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete an eval case — DELETE /eval-cases/:id
// ---------------------------------------------------------------------------

export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: casesKey(agentId) });
      void qc.invalidateQueries({ queryKey: runsKey(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Run the full eval set for an agent — POST /agents/:id/eval-runs → 202
// ---------------------------------------------------------------------------

export function useStartEvalSuiteRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseIds?: string[]) =>
      api.post<{ suite_run_id: string }>(
        `/agents/${agentId}/eval-runs`,
        caseIds ? { case_ids: caseIds } : undefined,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: casesKey(agentId) });
      void qc.invalidateQueries({ queryKey: runsKey(agentId) });
      void qc.invalidateQueries({ queryKey: dashboardKey(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Run a single case for debugging — POST /eval-cases/:id/run → 202
// ---------------------------------------------------------------------------

export function useRunEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<{ suite_run_id: string }>(`/eval-cases/${caseId}/run`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: casesKey(agentId) });
      void qc.invalidateQueries({ queryKey: runsKey(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// All-agents eval index — GET /eval/dashboard → EvalGlobalDashboard
// ---------------------------------------------------------------------------

export function useEvalGlobalDashboard() {
  return useQuery({
    queryKey: globalDashboardKey(),
    queryFn: () => api.get<EvalGlobalDashboard>("/eval/dashboard"),
    // Poll while any suite run across agents is running
    refetchInterval: (query) =>
      (query.state.data?.recent_runs ?? []).some((r) => r.status === "running")
        ? 5000
        : false,
  });
}

// ---------------------------------------------------------------------------
// Fetch a specific agent version — GET /agents/:id/versions/:version
// Used by CompareRunsModal to diff system prompts client-side.
// ---------------------------------------------------------------------------

export function useAgentVersion(
  agentId: string | null | undefined,
  version: number | null | undefined,
) {
  return useQuery({
    queryKey:
      agentId != null && version != null
        ? agentVersionKey(agentId, version)
        : ["agent-version", null, null],
    queryFn: () =>
      api.get<AgentVersion>(`/agents/${agentId}/versions/${version}`),
    enabled: agentId != null && version != null,
    staleTime: 5 * 60_000, // version snapshots are immutable
  });
}

// ---------------------------------------------------------------------------
// Run all agents — POST /eval/run-all → 202 { queued, agent_ids }
// Returns immediately; the server fans out sequentially in the background.
// Invalidates the global dashboard so rows start polling for updates.
// ---------------------------------------------------------------------------

export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>("/eval/run-all"),
    onSuccess: () => {
      // Invalidate the global dashboard so it starts polling (refetchInterval
      // fires while any suite run has status='running').
      void qc.invalidateQueries({ queryKey: globalDashboardKey() });
    },
  });
}

// ---------------------------------------------------------------------------
// Two-run fetch for compare — fetches two EvalSuiteRunDetail in parallel.
// Both ids must be non-null for the queries to fire.
// ---------------------------------------------------------------------------

export function useEvalRunPair(
  idA: string | null | undefined,
  idB: string | null | undefined,
) {
  const a = useQuery({
    queryKey: idA ? suiteRunKey(idA) : ["eval-suite-run", null],
    queryFn: () => api.get<EvalSuiteRunDetail>(`/eval-runs/${idA}`),
    enabled: !!idA,
  });
  const b = useQuery({
    queryKey: idB ? suiteRunKey(idB) : ["eval-suite-run", null],
    queryFn: () => api.get<EvalSuiteRunDetail>(`/eval-runs/${idB}`),
    enabled: !!idB,
  });
  return { a, b };
}
