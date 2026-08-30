/* AllAgentsRuns — RECENT EVAL RUNS · ALL AGENTS table section for /eval page.
   Thin wrapper over RecentRunsTable with the cross-agent section label. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import { RecentRunsTable } from "./RecentRunsTable";

export function AllAgentsRuns({ runs }: { runs: EvalSuiteRun[] }) {
  const t = useTranslations("eval");
  return (
    <RecentRunsTable
      runs={runs}
      sectionTitle={t("dashboard.allAgentsRuns")}
    />
  );
}
