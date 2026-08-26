/* ContextDocsPanel — the shared attach/reorder panel for a Context tab
   (agent or skill). Two consumers on day one (AgentEditor's ContextTab,
   SkillDetail's ContextTab), so it lives here rather than being written once
   and copied — `frontend-ui-architecture` §1's promotion rule. Thin
   owner-specific shells supply the repo-scoped document list, the owner's
   links, the set-mutation and the copy variant; this component owns the
   list/filter/attach/reorder/preview UI. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Badge, EmptyState, ErrorState, Icon, Markdown, Modal, Skeleton } from "@devdigest/ui";
import type { ContextDocLink, SpecFile } from "@devdigest/shared";
import { useContextDoc } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { arrangeDocs, attachedPathsInOrder, estTokens, filterDocs, moveItem, tokenTier } from "./helpers";
import { DocRow } from "./DocRow";
import { s } from "./styles";

export function ContextDocsPanel({
  variant,
  repoId,
  docs,
  docsLoading,
  docsError,
  onRetryDocs,
  links,
  linksLoading,
  linksError,
  onRetryLinks,
  onSetPaths,
}: {
  variant: "agent" | "skill";
  repoId: string | null | undefined;
  docs: SpecFile[] | undefined;
  docsLoading: boolean;
  docsError: boolean;
  onRetryDocs: () => void;
  links: ContextDocLink[] | undefined;
  linksLoading: boolean;
  linksError: boolean;
  onRetryLinks: () => void;
  onSetPaths: (paths: string[]) => void;
}) {
  const t = useTranslations("context");
  const router = useRouter();

  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const ordered = React.useMemo(() => arrangeDocs(docs ?? [], links ?? []), [docs, links]);
  const attached = React.useMemo(() => new Set((links ?? []).map((l) => l.path)), [links]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persist = (next: typeof ordered, nextAttached: ReadonlySet<string>) =>
    onSetPaths(attachedPathsInOrder(next, nextAttached));

  const toggle = (path: string, on: boolean) => {
    const nextAttached = new Set(attached);
    if (on) nextAttached.add(path);
    else nextAttached.delete(path);
    persist(ordered, nextAttached);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ordered.findIndex((d) => d.path === active.id);
    const to = ordered.findIndex((d) => d.path === over.id);
    persist(moveItem(ordered, from, to), attached);
  };

  if (docsLoading || linksLoading) {
    return (
      <div style={s.list}>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }

  if (docsError || linksError) {
    return (
      <ErrorState
        body={t("loadError")}
        onRetry={() => {
          onRetryDocs();
          onRetryLinks();
        }}
      />
    );
  }

  if ((docs ?? []).length === 0) {
    return (
      <EmptyState
        icon="FileText"
        title={t("empty.title")}
        body={t("empty.body")}
        cta={repoId ? t("attach.goToProjectContext") : undefined}
        onCta={repoId ? () => router.push(`/repos/${repoId}/context`) : undefined}
      />
    );
  }

  const visible = filterDocs(ordered, search);
  const canDrag = search.trim().length === 0;
  const tokens = estTokens(ordered, attached);
  const tier = tokenTier(tokens);

  return (
    <div>
      <div style={s.header}>
        <h2 style={s.title}>{t("title")}</h2>
        <Badge color="var(--accent)">
          {variant === "agent"
            ? t("attach.badge", { attached: attached.size, total: ordered.length })
            : t("attach.badgeSkill", { attached: attached.size })}
        </Badge>
        <div style={s.spacer} />
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("attach.filter")}
            style={s.filterInput}
          />
        </div>
      </div>

      <p style={s.hint}>{variant === "agent" ? t("attach.orderHint") : t("attach.inherits")}</p>
      <p style={s.hint}>{t("attach.injectedAs")}</p>

      <div style={s.tokens(tier)}>
        {tier !== "ok" && <Icon.AlertTriangle size={12} />}
        <span>{t("attach.tokens", { count: tokens })}</span>
        <span>{t("attach.tokensEstimate")}</span>
        {tier !== "ok" && <span>{t("attach.tokensWarning")}</span>}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="Search" title={t("attach.noMatchTitle")} body={t("attach.noMatchBody")} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={visible.map((d) => d.path)} strategy={verticalListSortingStrategy}>
            <div role="list" style={s.list}>
              {visible.map((doc) => (
                <DocRow
                  key={doc.path}
                  t={t}
                  doc={doc}
                  attached={attached.has(doc.path)}
                  draggable={canDrag}
                  onToggle={(on) => toggle(doc.path, on)}
                  onPreview={setPreviewPath}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {previewPath && (
        <PreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </div>
  );
}

function PreviewModal({
  repoId,
  path,
  onClose,
}: {
  repoId: string | null | undefined;
  path: string;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError, error } = useContextDoc(repoId, path);
  return (
    <Modal title={path} onClose={onClose} width={720}>
      {isLoading && <Skeleton height={120} />}
      {isError && (
        <ErrorState body={error instanceof ApiError ? error.message : t("doc.loadError")} />
      )}
      {!isLoading && !isError && <Markdown>{data?.content}</Markdown>}
    </Modal>
  );
}
