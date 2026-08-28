/* ContextTab — the skill detail's Context tab. A thin owner-specific shell,
   the skill twin of the agent editor's ContextTab: supplies the ACTIVE
   repository's document list, this skill's links, and the set-mutation to
   the shared ContextDocsPanel (skill-flavour copy), plus the manifest
   preview box (EC-19 — real heading, real paths, never the true
   serialization). */
"use client";

import React from "react";
import type { Skill } from "@devdigest/shared";
import { useTranslations } from "next-intl";
import { ContextDocsPanel, SerializesAsBox } from "@/components/context-docs";
import { attachedPathsInOrder, arrangeDocs } from "@/components/context-docs/helpers";
import { useActiveRepo } from "@/lib/repo-context";
import { useContextFiles, useSkillContextDocs, useSetSkillContextDocs } from "@/lib/hooks";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
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
  } = useSkillContextDocs(skill.id);
  const setPaths = useSetSkillContextDocs();

  // Injection order for the manifest preview — the same arrangement the
  // panel itself computes, restricted to the currently attached paths.
  const injectedPaths = React.useMemo(() => {
    const arranged = arrangeDocs(docs ?? [], links ?? []);
    const attached = new Set((links ?? []).map((l) => l.path));
    return attachedPathsInOrder(arranged, attached);
  }, [docs, links]);

  return (
    <div>
      <ContextDocsPanel
        variant="skill"
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
          setPaths.mutate({ skillId: skill.id, paths, ...(repoId ? { repoId } : {}) })
        }
      />
      <SerializesAsBox t={t} paths={injectedPaths} />
    </div>
  );
}
