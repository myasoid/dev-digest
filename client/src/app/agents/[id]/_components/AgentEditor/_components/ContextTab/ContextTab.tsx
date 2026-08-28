/* ContextTab — the agent editor's Context tab. A thin owner-specific shell:
   supplies the ACTIVE repository's document list, this agent's links, and
   the set-mutation to the shared ContextDocsPanel (agent-flavour copy). */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";
import { ContextDocsPanel } from "@/components/context-docs";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextFiles, useAgentContextDocs, useSetAgentContextDocs } from "@/lib/hooks";

export function ContextTab({ agent }: { agent: Agent }) {
  const { repoId } = useActiveRepo();
  const {
    data: docsResult,
    isLoading: docsLoading,
    isError: docsError,
    refetch: refetchDocs,
  } = useContextFiles(repoId);
  const docs = docsResult?.files;
  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
    refetch: refetchLinks,
  } = useAgentContextDocs(agent.id);
  const setPaths = useSetAgentContextDocs();

  return (
    <ContextDocsPanel
      variant="agent"
      repoId={repoId}
      docs={docs}
      docsLoading={docsLoading}
      docsError={docsError}
      onRetryDocs={() => void refetchDocs()}
      links={links}
      linksLoading={linksLoading}
      linksError={linksError}
      onRetryLinks={() => void refetchLinks()}
      onSetPaths={(paths) =>
        setPaths.mutate({ agentId: agent.id, paths, ...(repoId ? { repoId } : {}) })
      }
    />
  );
}
