import type { CSSProperties } from "react";

export const s = {
  // Card wrapper — matches IntentPanel's s.box treatment
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,

  // Header counts strip
  countsStrip: {
    display: "flex",
    gap: 24,
    padding: "4px 0",
    fontSize: 13,
    color: "var(--text-secondary)",
    flexWrap: "wrap",
  } satisfies CSSProperties,

  countItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  countNum: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  countDot: {
    color: "var(--border)",
    userSelect: "none",
  } satisfies CSSProperties,

  // Status banners
  bannerPartial: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  bannerDegraded: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  // Symbol tree
  symbolList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  symbolRow: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  symbolHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    cursor: "pointer",
    userSelect: "none",
    background: "transparent",
    border: "none",
    width: "100%",
    textAlign: "left",
  } satisfies CSSProperties,

  /**
   * Name and declaring file are STACKED, not side by side. Sharing one line
   * with a path (and an uppercase kind badge) collapsed the name to `width: 0`
   * once the panel moved from a full-width tab into a half-width Overview
   * column — the row rendered as `FUNCTION  client/…  1 caller` with the one
   * thing it exists to show missing entirely.
   */
  symbolMain: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
  } satisfies CSSProperties,

  symbolNameRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    minWidth: 0,
  } satisfies CSSProperties,

  symbolName: {
    fontSize: 13,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  symbolFile: {
    fontSize: 11,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
    direction: "rtl" as const,
    textAlign: "left" as const,
  } satisfies CSSProperties,

  callerCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  } satisfies CSSProperties,

  callerList: {
    borderTop: "1px solid var(--border)",
    padding: "8px 14px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,

  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
  } satisfies CSSProperties,

  // Chips row (endpoints / crons)
  chipsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,

  // Depth-2 chip style — outline only, subtler than depth-1
  chipDepth2: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    border: "1px dashed var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "default",
  } satisfies CSSProperties,

  // Prior PRs
  priorPrList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,

  priorPrRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13,
  } satisfies CSSProperties,
} as const;
