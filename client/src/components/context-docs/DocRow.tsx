/* DocRow — one draggable row in a Context tab: type badge, folder-prefixed
   path (EC-15), a Preview action, and the missing marker for an attached
   path absent from the repository (AC-18). */
"use client";

import React from "react";
import type { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import type { ContextDocRow } from "./helpers";
import { s } from "./styles";

const TYPE_COLOR: Record<ContextDocRow["type"], string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

export function DocRow({
  t,
  doc,
  attached,
  draggable,
  onToggle,
  onPreview,
}: {
  t: ReturnType<typeof useTranslations<"context">>;
  doc: ContextDocRow;
  attached: boolean;
  /** False while a filter is active — the visible subset is not the real order. */
  draggable: boolean;
  onToggle: (attached: boolean) => void;
  onPreview: (path: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: doc.path,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      role="listitem"
      aria-label={doc.path}
      style={{
        ...s.row(attached, isDragging, doc.missing),
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={t("attach.dragHandleLabel", { path: doc.path })}
        disabled={!draggable}
        style={s.handle(draggable)}
      >
        <Icon.Menu size={14} />
      </button>

      <Checkbox
        checked={attached}
        onChange={onToggle}
        label={
          <span className="mono" style={s.path}>
            {doc.path}
          </span>
        }
      />

      {doc.missing && (
        <span style={s.missingNote} title={t("attach.missing")}>
          <Icon.AlertTriangle size={12} />
        </span>
      )}

      <Badge color={TYPE_COLOR[doc.type]}>{t(`type.${doc.type}`)}</Badge>

      <button
        type="button"
        aria-label={t("attach.preview", { path: doc.path })}
        style={s.previewBtn}
        onClick={() => onPreview(doc.path)}
      >
        <Icon.Eye size={12} />
      </button>
    </div>
  );
}
