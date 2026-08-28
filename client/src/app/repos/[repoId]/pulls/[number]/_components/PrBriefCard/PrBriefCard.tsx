/* PrBriefCard — SPEC-cross-06: a cached, one-LLM-call brief `{ what, why,
   risk_level, risks[], review_focus[] }` shown at the top of the PR Overview
   tab. Data via usePrBrief/useRefreshBrief (threaded from OverviewTab, same
   props-driven shape as IntentPanel) + usePrReviews (own hook call, for the
   display-only score/verdict/findings-count already shown elsewhere — this
   card never generates those). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, Icon, MonoLink, SectionLabel, Skeleton } from "@devdigest/ui";
import type { BriefFocusItem, BriefRisk, PrBrief, RiskLevel } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

/** Above this, `what`/`why` clamp with a "Show more" affordance (EC-7) —
 *  never a silent clip. */
const WHAT_WHY_CLAMP_CHARS = 220;
/** Review-focus items shown before a visible "N of M" affordance (EC-8) —
 *  no server cap, so this is purely a display truncation. */
const REVIEW_FOCUS_DISPLAY_CAP = 5;

const RISK_LEVEL_META: Record<
  RiskLevel,
  { color: string; bg: string; icon: "AlertOctagon" | "AlertTriangle" | "CheckCircle" }
> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
};

type BriefT = ReturnType<typeof useTranslations<"brief">>;

/** `what`/`why` paragraph with a clamp + expand affordance (EC-7) — never a
 *  silent clip. */
function ExpandableText({ text, t }: { text: string; t: BriefT }) {
  const [expanded, setExpanded] = React.useState(false);
  const isLong = text.length > WHAT_WHY_CLAMP_CHARS;
  const shown = !isLong || expanded ? text : `${text.slice(0, WHAT_WHY_CLAMP_CHARS).trimEnd()}…`;
  return (
    <div>
      <p style={s.bodyText}>{shown}</p>
      {isLong && (
        <button type="button" style={s.expandBtn} onClick={() => setExpanded((e) => !e)}>
          {expanded ? t("collapse") : t("expand")}
        </button>
      )}
    </div>
  );
}

/** `risks[]` — independent of `review_focus[]` (EC-9): a risk is not
 *  required to also appear as a focus item, or vice versa. Not clickable —
 *  only `review_focus[]` drives SHA-pinned links (AC-9). */
function RisksSection({ risks, t }: { risks: BriefRisk[]; t: BriefT }) {
  return (
    <section>
      <SectionLabel icon="AlertTriangle">{t("risks.title")}</SectionLabel>
      {risks.length === 0 ? (
        <div style={s.emptyBody}>{t("risks.empty")}</div>
      ) : (
        <div style={s.risksList}>
          {risks.map((risk, i) => (
            <div key={i} style={s.riskItem}>
              <div style={s.riskTitle}>{risk.title}</div>
              <div style={s.riskExplain}>{risk.explanation}</div>
              {risk.refs.length > 0 && <div style={s.riskRefs}>{risk.refs.join(", ")}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** `review_focus[]` — clickable, keyboard-focusable `file:line` links pinned
 *  to the BRIEF's stored head SHA, not the PR's current head (AC-9). An
 *  empty list is a distinct, generated answer ("nothing rose to read-first",
 *  EC-6) — never rendered as the no-brief-yet empty state. */
function ReviewFocusSection({
  items,
  briefHeadSha,
  repoFullName,
  t,
}: {
  items: BriefFocusItem[];
  briefHeadSha: string | null | undefined;
  repoFullName: string | null;
  t: BriefT;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const truncated = items.length > REVIEW_FOCUS_DISPLAY_CAP;
  const shown = expanded || !truncated ? items : items.slice(0, REVIEW_FOCUS_DISPLAY_CAP);

  return (
    <section>
      <SectionLabel icon="ListChecks">{t("reviewFocus.title")}</SectionLabel>
      {items.length === 0 ? (
        <div style={s.emptyBody}>{t("reviewFocus.empty")}</div>
      ) : (
        <>
          <ul style={s.focusList}>
            {shown.map((item, i) => {
              const href =
                repoFullName && briefHeadSha
                  ? githubBlobUrl(repoFullName, briefHeadSha, item.ref, item.line ?? undefined)
                  : undefined;
              return (
                <li key={`${item.ref}:${item.line ?? ""}:${i}`} style={s.focusItem}>
                  <Icon.FileText size={13} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <MonoLink href={href}>{item.line != null ? `${item.ref}:${item.line}` : item.ref}</MonoLink>
                    <div style={s.focusDesc}>{item.description}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          {truncated && (
            <button type="button" style={s.expandBtn} onClick={() => setExpanded((e) => !e)}>
              {expanded ? t("collapse") : t("reviewFocus.nOfM", { shown: shown.length, total: items.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

interface PrBriefCardProps {
  prId: string | null;
  brief: PrBrief | null | undefined;
  /** True while `usePrBrief`'s cached GET is loading. */
  isLoading: boolean;
  /** The PR's current head SHA — compared against `brief.head_sha` for
   *  staleness (AC-4); NOT used for the review-focus links (AC-9). */
  headSha: string;
  repoFullName: string | null;
  onGenerate: () => void;
  /** True while `useRefreshBrief`'s mutation is in flight. */
  generating: boolean;
  /** True when the last `useRefreshBrief` call failed. */
  generateError: boolean;
}

/**
 * PR Brief card — shown at the top of the Overview tab. Renders whichever of
 * the seven states applies: loading, error (retry, card persists), no brief
 * yet (empty state + Generate control, AC-14), or a generated brief — which
 * may additionally be partial (signals-used indicator, AC-13), stale
 * (regenerate affordance, AC-4), and/or have an empty `review_focus[]`
 * (EC-6) — these three are independent flags on the same content, not
 * mutually exclusive layouts.
 */
export function PrBriefCard({
  prId,
  brief,
  isLoading,
  headSha,
  repoFullName,
  onGenerate,
  generating,
  generateError,
}: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data: reviews } = usePrReviews(prId);
  const latestReview = reviews?.find((r) => r.kind === "review");
  const findingsCount = latestReview?.findings.length ?? 0;
  const blockers = latestReview?.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length ?? 0;

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <div style={s.box}>
          <Skeleton height={16} width={220} />
          <Skeleton height={40} />
          <Skeleton height={60} />
        </div>
      </section>
    );
  }

  if (generateError) {
    return (
      <section>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <div style={s.box}>
          <EmptyState
            icon="AlertTriangle"
            title={t("error.title")}
            body={t("error.body")}
            cta={t("error.retry")}
            onCta={onGenerate}
            ctaLoading={generating}
          />
        </div>
      </section>
    );
  }

  if (!brief) {
    return (
      <section>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <div style={s.box}>
          <EmptyState
            icon="Sparkles"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("generate")}
            onCta={onGenerate}
            ctaLoading={generating}
          />
        </div>
      </section>
    );
  }

  const stale = brief.head_sha != null && brief.head_sha !== headSha;
  // Provisional heuristic (OQ-4 territory): "partial" flags a brief missing
  // one of the two inputs the service computes automatically (Intent,
  // Blast) — the PR-authored inputs (issue/specs) are legitimately absent
  // for many thin PRs (EC-4) and don't alone make a brief read as partial.
  const partial = !brief.signals_used.includes("intent") || !brief.signals_used.includes("blast");
  const meta = RISK_LEVEL_META[brief.risk_level];

  return (
    <section>
      <SectionLabel
        icon="Sparkles"
        right={
          <Button size="sm" kind="ghost" icon="RefreshCw" loading={generating} onClick={onGenerate}>
            {t("regenerate")}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.box}>
        <div style={s.headerRow}>
          <Badge color={meta.color} bg={meta.bg} icon={meta.icon}>
            {t(`riskLevel.${brief.risk_level}`)}
          </Badge>
          {stale && (
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("stale")}
            </Badge>
          )}
          {partial && (
            <Badge color="var(--text-muted)" bg="var(--bg-hover)" icon="Info">
              {t("partial")}
            </Badge>
          )}
          {latestReview && (
            <Badge color="var(--text-secondary)">
              {latestReview.score != null ? t("reviewScore", { score: latestReview.score }) : null}
              {latestReview.score != null ? " · " : ""}
              {t("reviewFindings", { count: findingsCount })}
              {blockers > 0 ? ` · ${t("reviewBlockers", { count: blockers })}` : ""}
            </Badge>
          )}
        </div>

        <div style={s.section}>
          <span style={s.fieldLabel}>{t("what")}</span>
          <ExpandableText text={brief.what} t={t} />
        </div>
        <div style={s.section}>
          <span style={s.fieldLabel}>{t("why")}</span>
          <ExpandableText text={brief.why} t={t} />
        </div>

        <RisksSection risks={brief.risks} t={t} />
        <ReviewFocusSection
          items={brief.review_focus}
          briefHeadSha={brief.head_sha}
          repoFullName={repoFullName}
          t={t}
        />

        {brief.signals_used.length > 0 && (
          <div style={s.signalsNote}>{t("signalsUsed", { signals: brief.signals_used.join(", ") })}</div>
        )}
      </div>
    </section>
  );
}
