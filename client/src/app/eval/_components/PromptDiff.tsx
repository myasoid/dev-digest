/* PromptDiff — line-level add/remove highlighting for system prompt diffs.
   Pure presentational — computes the diff client-side with a Myers-diff approach
   (word/line level). No dependencies beyond React. */
"use client";

import React from "react";

/** A line in the rendered diff. */
interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
}

/** Naive line-diff: LCS-based Myers diff on lines. Pure function. */
function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i]![j] = 1 + dp[i + 1]![j + 1]!;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  // Trace back through the LCS table
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ kind: "same", text: oldLines[i]! });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      result.push({ kind: "added", text: newLines[j]! });
      j++;
    } else {
      result.push({ kind: "removed", text: oldLines[i]! });
      i++;
    }
  }
  return result;
}

const COLORS = {
  added: { bg: "rgba(0,200,80,0.10)", border: "rgba(0,200,80,0.35)", prefix: "+" },
  removed: { bg: "rgba(220,50,50,0.10)", border: "rgba(220,50,50,0.35)", prefix: "−" },
  same: { bg: "transparent", border: "transparent", prefix: " " },
} as const;

export function PromptDiff({
  oldPrompt,
  newPrompt,
  identicalMessage = "System prompts are identical.",
}: {
  oldPrompt: string;
  newPrompt: string;
  /** Translated string shown when old === new. Pass from useTranslations in the parent. */
  identicalMessage?: string;
}) {
  const lines = diffLines(oldPrompt, newPrompt);

  if (lines.every((l) => l.kind === "same")) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "16px 0" }}>
        {identicalMessage}
      </p>
    );
  }

  return (
    <div
      style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 12,
        lineHeight: 1.6,
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "auto",
        maxHeight: 360,
      }}
    >
      {lines.map((line, idx) => {
        const c = COLORS[line.kind];
        return (
          <div
            key={idx}
            style={{
              display: "flex",
              background: c.bg,
              borderLeft: line.kind !== "same" ? `3px solid ${c.border}` : "3px solid transparent",
              paddingLeft: 10,
              paddingRight: 16,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            <span
              style={{
                width: 16,
                flexShrink: 0,
                color: line.kind === "added"
                  ? "var(--ok)"
                  : line.kind === "removed"
                  ? "var(--crit)"
                  : "var(--text-muted)",
                userSelect: "none",
              }}
            >
              {c.prefix}
            </span>
            <span style={{ color: line.kind === "same" ? "var(--text-secondary)" : "inherit" }}>
              {line.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
