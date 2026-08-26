/* hooks/context.ts — React Query hooks for the Project Context feature: a
   single document's body (N6 preview / Context tab Preview), and the
   agent/skill attachment set (Context tabs). `useContextFiles` /
   `useReindexContext` (the repo-scoped list + refresh) already live in
   ./core.ts — written when the contract existed but unreachable, now wired. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ContextDocLink, SpecFile } from "@devdigest/shared";

/** One document's full body, keyed by repo + path so a preview is cached per
 *  document (the N6 preview pane and every Context tab's Preview button share
 *  this one cache). */
export function useContextDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () => api.get<SpecFile>(`/repos/${repoId}/context/doc?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!repoId && !!path,
  });
}

/** Documents attached to an agent, ordered — the agent editor's Context tab. */
export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId],
    queryFn: () => api.get<ContextDocLink[]>(`/agents/${agentId}/context-docs`),
    enabled: !!agentId,
  });
}

/**
 * Set-and-reorder an agent's attached documents in one call. Every
 * set-mutation also invalidates `["context", repoId]` — that query is where
 * `used_by_agents` and (via the agent/skill list) `context_doc_count` come
 * from, and the spec calls this out explicitly: without it, the repo's
 * Project Context page and the badge this tab just changed would disagree
 * until an unrelated refetch happened to land.
 *
 * OPTIMISTIC, for the same reason `useSetAgentSkills` is: the request
 * replaces the WHOLE set, computed from the currently-cached links, so a
 * second toggle fired before the first response lands would otherwise be
 * built from the pre-first-toggle state and silently lose it.
 */
export function useSetAgentContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { agentId: string; paths: string[]; repoId?: string }) =>
      api.post<ContextDocLink[]>(`/agents/${vars.agentId}/context-docs`, { paths: vars.paths }),
    onMutate: async ({ agentId, paths }) => {
      const key = ["agent-context-docs", agentId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextDocLink[]>(key);
      qc.setQueryData<ContextDocLink[]>(
        key,
        paths.map((path, order) => ({ owner_kind: "agent", owner_id: agentId, path, order })),
      );
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSuccess: (data, { agentId }) => {
      qc.setQueryData(["agent-context-docs", agentId], data);
    },
    onSettled: (_d, _e, { agentId, repoId }) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      if (repoId) qc.invalidateQueries({ queryKey: ["context", repoId] });
    },
  });
}

/** Documents attached to a skill, ordered — the skill detail's Context tab. */
export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId],
    queryFn: () => api.get<ContextDocLink[]>(`/skills/${skillId}/context-docs`),
    enabled: !!skillId,
  });
}

/** Set-and-reorder a skill's attached documents. Optimistic for the same
 *  lost-update reason as `useSetAgentContextDocs`; see its comment. Every
 *  caller should pass `repoId` when it has one in view (same reason). */
export function useSetSkillContextDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { skillId: string; paths: string[]; repoId?: string }) =>
      api.post<ContextDocLink[]>(`/skills/${vars.skillId}/context-docs`, { paths: vars.paths }),
    onMutate: async ({ skillId, paths }) => {
      const key = ["skill-context-docs", skillId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextDocLink[]>(key);
      qc.setQueryData<ContextDocLink[]>(
        key,
        paths.map((path, order) => ({ owner_kind: "skill", owner_id: skillId, path, order })),
      );
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSuccess: (data, { skillId }) => {
      qc.setQueryData(["skill-context-docs", skillId], data);
    },
    onSettled: (_d, _e, { skillId, repoId }) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill", skillId] });
      if (repoId) qc.invalidateQueries({ queryKey: ["context", repoId] });
    },
  });
}
