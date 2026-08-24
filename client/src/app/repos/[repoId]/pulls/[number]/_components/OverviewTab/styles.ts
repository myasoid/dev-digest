import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,

  /** Two-column row: Intent left, Blast right. Stacks to one column on narrow
   *  viewports via the minmax() track — each column is at least 280px, so at
   *  ~600px total width the grid auto-fits to one column with no overflow. */
  panelGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 24,
    alignItems: "start",
  } satisfies CSSProperties,
} as const;
