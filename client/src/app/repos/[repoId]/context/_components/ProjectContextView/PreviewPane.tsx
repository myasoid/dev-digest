/* PreviewPane — renders the selected document's markdown. Owns its OWN
   loading/error state, so a failed body read never blanks the document list
   next to it (AC-11 client side). Read-only: renders no edit/save/upload
   control (AC-12, Non-goals). */
"use client";

import React from "react";
import type { useTranslations } from "next-intl";
import { Badge, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { useContextDoc } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { s } from "./styles";

export function PreviewPane({
  t,
  repoId,
  path,
}: {
  t: ReturnType<typeof useTranslations<"context">>;
  repoId: string;
  path: string | null;
}) {
  const { data, isLoading, isError, error, refetch } = useContextDoc(repoId, path);

  if (!path) {
    return (
      <div style={s.placeholder}>
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("selectPrompt")}</span>
      </div>
    );
  }

  return (
    <div style={s.previewPane}>
      <div style={s.previewHeader}>
        {data && <Badge color="var(--text-secondary)">{t(`type.${data.type}`)}</Badge>}
        <span className="mono" style={{ fontSize: 13 }}>
          {path}
        </span>
      </div>
      <div style={s.previewBody}>
        {isLoading && <Skeleton height={200} />}
        {isError && (
          <ErrorState
            body={error instanceof ApiError ? error.message : t("doc.loadError")}
            onRetry={() => void refetch()}
          />
        )}
        {!isLoading && !isError && <Markdown>{data?.content}</Markdown>}
      </div>
    </div>
  );
}
