/* /repos/:repoId/context — the Project Context page (N6). Document list,
   toolbar refresh, preview pane, footer status. Renders NO control that
   edits, saves, uploads or creates a document (AC-12, Non-goals: the only
   copy of a document lives under server/clones/**, and a Save button here
   would silently lose the user's work on the next resync). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useContextFiles, useReindexContext } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { DocList } from "./DocList";
import { PreviewPane } from "./PreviewPane";
import { formatRelativeTime } from "./helpers";
import { s } from "./styles";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repoName = activeRepo?.full_name ?? repoId;

  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useContextFiles(repoId);
  const reindex = useReindexContext();
  const docs = data?.files;
  const truncated = data?.truncated ?? false;

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const crumb = [{ label: repoName }, { label: t("title") }];
  const notSynced = error instanceof ApiError && error.code === "repo_not_synced";

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.listPane}>
          <div style={s.toolbar}>
            <h1 style={s.title}>{t("title")}</h1>
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={reindex.isPending}
              onClick={() => reindex.mutate(repoId)}
            >
              {reindex.isPending ? t("indexing") : t("reindex")}
            </Button>
          </div>

          {isLoading && (
            <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton height={32} />
              <Skeleton height={32} />
              <Skeleton height={32} />
            </div>
          )}

          {!isLoading && notSynced && (
            <div style={{ padding: 16 }}>
              <EmptyState icon="AlertTriangle" title={t("notSynced.title")} body={t("notSynced.body")} />
            </div>
          )}

          {!isLoading && isError && !notSynced && (
            <div style={{ padding: 16 }}>
              <ErrorState body={t("loadError")} onRetry={() => refetch()} />
            </div>
          )}

          {!isLoading && !isError && (docs ?? []).length === 0 && (
            <div style={{ padding: 16 }}>
              <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
            </div>
          )}

          {!isLoading && !isError && (docs ?? []).length > 0 && (
            <>
              <DocList t={t} docs={docs ?? []} selectedPath={selectedPath} onSelect={setSelectedPath} />
              {truncated && (
                <div style={s.truncatedBanner}>
                  <Icon.AlertTriangle size={12} />
                  <span>{t("footer.truncated", { shown: (docs ?? []).length })}</span>
                </div>
              )}
              <div style={s.footer}>
                {t("footer.documents", { count: (docs ?? []).length })}
                {" · "}
                {t("footer.refreshed", {
                  relative: formatRelativeTime(new Date(dataUpdatedAt).toISOString()),
                })}
              </div>
            </>
          )}
        </div>

        <PreviewPane t={t} repoId={repoId} path={selectedPath} />
      </div>
    </AppShell>
  );
}
