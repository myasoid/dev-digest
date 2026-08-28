"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import {
  usePrIntent,
  useRefreshIntent,
  usePrBrief,
  useRefreshBrief,
} from "../../../../../../../lib/hooks/reviews";
import { IntentPanel } from "../IntentPanel";
import { BlastPanel } from "../BlastPanel";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  headSha: string;
  /** Owner/repo string (e.g. "acme/payments-api") — threaded from page.tsx for
   *  GitHub blob deep-links in BlastPanel. Null until the active repo loads. */
  repoFullName: string | null;
}

/** The PR Brief card (SPEC-cross-06) sits above the Intent/Blast row — it
 *  distils both into a one-paragraph "what and why" plus a read-these-first
 *  list, so a reviewer sees the synthesis before the raw signals. Intent is
 *  shown next — BEFORE the review findings tab — so a reviewer sees what the
 *  PR claims to do (and its declared scope) before diving into the code.
 *  Blast Radius sits to its right, giving a full impact picture at a glance
 *  without navigating to a separate tab. */
export function OverviewTab({ prId, prBody, headSha, repoFullName }: OverviewTabProps) {
  const { data: intent, isLoading: intentLoading } = usePrIntent(prId);
  const refresh = useRefreshIntent(prId);
  const { data: brief, isLoading: briefLoading } = usePrBrief(prId);
  const refreshBrief = useRefreshBrief(prId);

  return (
    <>
      <PrBriefCard
        prId={prId}
        brief={brief}
        isLoading={briefLoading}
        headSha={headSha}
        repoFullName={repoFullName}
        onGenerate={() => refreshBrief.mutate()}
        generating={refreshBrief.isPending}
        generateError={refreshBrief.isError}
      />

      {/* Two-column row: Intent left, Blast Radius right */}
      <div style={s.panelGrid}>
        <IntentPanel
          intent={intent}
          isLoading={intentLoading}
          headSha={headSha}
          onRefresh={() => refresh.mutate()}
          refreshing={refresh.isPending}
        />
        <BlastPanel prId={prId} repoFullName={repoFullName} />
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
