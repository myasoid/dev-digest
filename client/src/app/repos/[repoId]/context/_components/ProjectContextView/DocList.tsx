/* DocList — the N6 page's left-hand document list. Selecting a row drives
   the preview pane; no control here edits, saves, uploads or creates
   anything (AC-12). */
"use client";

import React from "react";
import { Badge } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import type { useTranslations } from "next-intl";
import { s } from "./styles";

const TYPE_COLOR: Record<SpecFile["type"], string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

export function DocList({
  t,
  docs,
  selectedPath,
  onSelect,
}: {
  t: ReturnType<typeof useTranslations<"context">>;
  docs: SpecFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div style={s.list}>
      {docs.map((doc) => (
        // Not role="listitem" — jsx-a11y (rightly) rejects mouse/keyboard
        // listeners on a non-interactive role. role="button" + tabIndex +
        // onKeyDown is the same shape PRRow/FindingsCell already use for a
        // clickable row whose accessible name comes from its own content.
        <div
          key={doc.path}
          role="button"
          aria-pressed={doc.path === selectedPath}
          tabIndex={0}
          onClick={() => onSelect(doc.path)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(doc.path);
            }
          }}
          style={s.row(doc.path === selectedPath)}
        >
          <Badge color={TYPE_COLOR[doc.type]}>{t(`type.${doc.type}`)}</Badge>
          <span className="mono" style={s.rowPath}>
            {doc.path}
          </span>
          {/* Nullish, not just falsy — G-7/US-8: omit rather than report a
              wrong 0 when the server had no cheap way to compute it. */}
          {doc.used_by_agents != null && <span style={s.usedBy}>{t("usedBy", { count: doc.used_by_agents })}</span>}
        </div>
      ))}
    </div>
  );
}
