/* RegressionAlert — renders EvalDashboard.alert as a dismissible banner.
   Receives the alert string (from the contract); renders null if falsy. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";

export function RegressionAlert({ alert }: { alert: string | null }) {
  const t = useTranslations("eval.dashboard");
  if (!alert) return null;
  return (
    <div
      role="alert"
      style={{
        background: "rgba(220,50,50,0.08)",
        border: "1px solid rgba(220,50,50,0.35)",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        color: "var(--crit)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 20,
      }}
    >
      <span style={{ fontWeight: 600 }}>{t("regressionAlert")}</span>
      <span style={{ color: "var(--text-secondary)" }}>{alert}</span>
    </div>
  );
}
