/* BlastPanel — impact map for a PR: changed symbols → callers → endpoints/crons.
   Data from GET /pulls/:id/blast (PrBlastMap contract).
   Shown on the Overview tab, to the right of IntentPanel. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, EmptyState, SectionLabel, MonoLink, Chip, Skeleton } from "@devdigest/ui";
import type { PrBlastMap, PrBlastSymbol, PrBlastTarget } from "@devdigest/shared";
import { useBlastRadius } from "@/lib/hooks/blast";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

// ---------------------------------------------------------------------------
// Sub-components — each pure/presentational
// ---------------------------------------------------------------------------

/** Warning/error banner when status !== 'ok'. */
function StatusBanner({
  status,
  explanation,
}: {
  status: "partial" | "degraded";
  explanation: string;
}) {
  const isDegraded = status === "degraded";
  return (
    <div role="alert" style={isDegraded ? s.bannerDegraded : s.bannerPartial}>
      <Icon.AlertTriangle
        size={15}
        style={{
          color: isDegraded ? "var(--crit)" : "var(--warn)",
          flexShrink: 0,
          marginTop: 1,
        }}
      />
      <span>{explanation}</span>
    </div>
  );
}

/** Header counts strip: N symbols · N callers · N endpoints · N crons */
function CountsStrip({
  counts,
  t,
}: {
  counts: PrBlastMap["counts"];
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  const items = [
    { key: "symbols" as const, value: counts.symbols },
    { key: "callers" as const, value: counts.callers },
    { key: "endpoints" as const, value: counts.endpoints },
    { key: "crons" as const, value: counts.crons },
  ];
  return (
    <div style={s.countsStrip}>
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {i > 0 && (
            <span style={s.countDot} aria-hidden>
              ·
            </span>
          )}
          <span style={s.countItem}>
            <span style={s.countNum}>{item.value}</span>{" "}
            <span>{t(`stat.${item.key}`)}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/** One expanded/collapsed symbol row with its callers. */
function SymbolRow({
  symbol,
  repoFullName,
  indexedSha,
  t,
}: {
  symbol: PrBlastSymbol;
  repoFullName: string | null;
  indexedSha: string | null;
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const hasCallers = symbol.callers.length > 0;

  // Truncation label: "20 of 47 callers" when truncated, "20 callers" when not.
  const callerLabel = symbol.truncated
    ? t("callerCountTruncated", { shown: symbol.callers.length, total: symbol.callerCount })
    : t("callerCount", { count: symbol.callerCount });

  return (
    <div style={s.symbolRow}>
      {/* Header: click to expand if there are callers */}
      <button
        style={s.symbolHeader}
        onClick={() => hasCallers && setExpanded((e) => !e)}
        aria-expanded={hasCallers ? expanded : undefined}
        disabled={!hasCallers}
      >
        <Icon.ChevronRight
          size={14}
          style={{
            color: "var(--text-muted)",
            flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform .12s",
            opacity: hasCallers ? 1 : 0.3,
          }}
        />
        {/* The symbol NAME is the headline of the row and gets the flexible
            space. The declaring file sits on its own line beneath: in a
            half-width panel a path competing for the same line starves the
            name to zero width, which is the one thing the row must show. */}
        <span style={s.symbolMain}>
          <span style={s.symbolNameRow}>
            <Icon.Code size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <span style={s.symbolName} title={`${symbol.kind} ${symbol.name}`}>
              {symbol.name}
            </span>
          </span>
          <span style={s.symbolFile} title={symbol.file}>
            {symbol.file}
          </span>
        </span>
        <span style={s.callerCount}>
          {hasCallers ? callerLabel : t("noCallers")}
        </span>
      </button>

      {/* Callers list — shown when expanded */}
      {expanded && hasCallers && (
        <div style={s.callerList}>
          {symbol.callers.map((caller, idx) => {
            const label = `${caller.file}:${caller.line}`;
            const href =
              repoFullName && indexedSha
                ? githubBlobUrl(repoFullName, indexedSha, caller.file, caller.line)
                : undefined;
            return (
              <div key={idx} style={s.callerRow}>
                <Icon.CornerDownRight
                  size={12}
                  style={{ color: "var(--text-muted)", flexShrink: 0 }}
                />
                <MonoLink href={href}>{label}</MonoLink>
                {caller.symbol && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("callerIn", { symbol: caller.symbol })}
                  </span>
                )}
              </div>
            );
          })}
          {symbol.truncated && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                paddingLeft: 20,
                paddingTop: 4,
              }}
            >
              {t("truncationNote", {
                shown: symbol.callers.length,
                total: symbol.callerCount,
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Single endpoint or cron chip. Depth-2 gets an outline/dashed treatment. */
function TargetChip({
  target,
  color,
  t,
}: {
  target: PrBlastTarget;
  color: string;
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  if (target.depth === 2) {
    return (
      <span
        style={s.chipDepth2}
        title={t("depth2Title", { viaFiles: target.viaFiles.join(", ") })}
      >
        {target.label}
      </span>
    );
  }
  return <Chip color={color}>{target.label}</Chip>;
}

/** Endpoints section. */
function EndpointsSection({
  endpoints,
  t,
}: {
  endpoints: PrBlastTarget[];
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  if (endpoints.length === 0) return null;
  return (
    <section>
      <SectionLabel icon="Globe">{t("impactedEndpoints")}</SectionLabel>
      <div style={s.chipsRow}>
        {endpoints.map((ep, i) => (
          <TargetChip key={i} target={ep} color="var(--accent)" t={t} />
        ))}
      </div>
    </section>
  );
}

/** Crons section. */
function CronsSection({
  crons,
  t,
}: {
  crons: PrBlastTarget[];
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  if (crons.length === 0) return null;
  return (
    <section>
      <SectionLabel icon="Clock">{t("scheduledJobs")}</SectionLabel>
      <div style={s.chipsRow}>
        {crons.map((cron, i) => (
          <TargetChip key={i} target={cron} color="var(--warn)" t={t} />
        ))}
      </div>
    </section>
  );
}

/** Prior PRs — scaffolding for phase 3. */
function PriorPrsSection({
  priorPrs,
  t,
}: {
  priorPrs: PrBlastMap["priorPrs"];
  t: ReturnType<typeof useTranslations<"blast">>;
}) {
  if (priorPrs.length === 0) return null;
  return (
    <section>
      <SectionLabel icon="GitPullRequest">{t("priorPrs")}</SectionLabel>
      <div style={s.priorPrList}>
        {priorPrs.map((pr) => (
          <div key={pr.number} style={s.priorPrRow}>
            <Icon.GitPullRequest
              size={14}
              style={{ color: "var(--text-muted)", flexShrink: 0 }}
            />
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--accent-text)",
                textDecoration: "none",
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              #{pr.number} {pr.title}
            </a>
            <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
              {t("priorPrsSharedFiles", { count: pr.sharedFiles.length })}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface BlastPanelProps {
  prId: string | null;
  repoFullName: string | null;
}

export function BlastPanel({ prId, repoFullName }: BlastPanelProps) {
  const t = useTranslations("blast");
  const { data: blast, isLoading, isError } = useBlastRadius(prId);

  if (isLoading || !prId) {
    return (
      <section>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.box}>
          {[180, 120, 80].map((w, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      </section>
    );
  }

  if (isError || !blast) {
    return (
      <section>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.box}>
          <EmptyState
            icon="AlertTriangle"
            title={t("errorTitle")}
            body={t("errorBody")}
          />
        </div>
      </section>
    );
  }

  // Empty state: index is good but nothing downstream was found.
  // This must NOT look like an error — it is a valid, informative answer.
  if (blast.status === "ok" && blast.symbols.length === 0) {
    return (
      <section>
        <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
        <div style={s.box}>
          <EmptyState
            icon="CheckCircle"
            title={t("emptyTitle")}
            body={t("emptyBody")}
          />
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
      <div style={s.box}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Counts strip */}
          <CountsStrip counts={blast.counts} t={t} />

          {/* Status banner — non-ok status must always be visible */}
          {blast.status !== "ok" && blast.explanation && (
            <StatusBanner status={blast.status} explanation={blast.explanation} />
          )}

          {/* Symbol tree */}
          {blast.symbols.length > 0 && (
            <section>
              <SectionLabel icon="Workflow">
                {t("changedSymbols")}
                {blast.symbolsTruncated && (
                  <span
                    style={{
                      fontWeight: 400,
                      textTransform: "none",
                      letterSpacing: 0,
                      marginLeft: 8,
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    {t("symbolsCapped")}
                  </span>
                )}
              </SectionLabel>
              <div style={s.symbolList}>
                {blast.symbols.map((sym, i) => (
                  <SymbolRow
                    key={`${sym.file}:${sym.name}:${i}`}
                    symbol={sym}
                    repoFullName={repoFullName}
                    indexedSha={blast.indexedSha}
                    t={t}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Endpoints and crons */}
          <EndpointsSection endpoints={blast.endpoints} t={t} />
          <CronsSection crons={blast.crons} t={t} />

          {/* Prior PRs — forward-compatible scaffolding */}
          <PriorPrsSection priorPrs={blast.priorPrs} t={t} />
        </div>
      </div>
    </section>
  );
}
