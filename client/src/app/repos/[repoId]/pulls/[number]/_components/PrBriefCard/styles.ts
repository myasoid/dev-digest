import type { CSSProperties } from "react";

export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  fieldLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  bodyText: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    margin: 0,
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  expandBtn: {
    background: "none",
    border: "none",
    padding: 0,
    marginTop: 4,
    fontSize: 12,
    color: "var(--accent-text)",
    cursor: "pointer",
  } satisfies CSSProperties,
  risksList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  riskItem: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  riskTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  riskExplain: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  riskRefs: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  focusList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    listStyle: "none",
    margin: 0,
    padding: 0,
  } satisfies CSSProperties,
  focusItem: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
  } satisfies CSSProperties,
  focusDesc: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  signalsNote: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
