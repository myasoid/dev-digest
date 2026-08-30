/* CitationAccuracyNote — disclosure that FULL_FILE_KINDS findings are exempt
   from the grounding gate's line-intersection check, so a high citation_accuracy
   may mean "the gate had little to check" rather than "citations are accurate".

   Criterion 15: mount wherever citation_accuracy is displayed.
   Two known consumers at plan time → lives in shared components/ (promotion rule). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";

/** Inline tooltip/note disclosure for citation_accuracy. */
export function CitationAccuracyNote() {
  const t = useTranslations("eval.citationNote");
  const [open, setOpen] = React.useState(false);

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        title={t("label")}
        aria-label={t("label")}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none",
          border: "none",
          padding: "0 2px",
          cursor: "pointer",
          color: "var(--text-muted)",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <Icon.Info size={13} />
      </button>
      {open && (
        <>
          {/* Dismiss on outside click */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            role="tooltip"
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 50,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              padding: "10px 14px",
              width: 300,
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--text-secondary)",
              boxShadow: "var(--shadow-modal)",
            }}
          >
            {t("body")}
          </div>
        </>
      )}
    </span>
  );
}
