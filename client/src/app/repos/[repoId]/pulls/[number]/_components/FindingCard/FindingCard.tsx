/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps.

   Step 22: "Turn into eval case" action — disabled with tooltip reason when
   the finding is undecided (criterion 3); hidden entirely when agentId is
   absent (Decision A: no owner to attach the case to). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  agentId,
  onCreateEvalCase,
  isCreatingEvalCase,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /**
   * The agent_id from the review that produced this finding.
   * Decision A: when absent the "Turn into eval case" button is hidden entirely
   * (no owner to attach a case to, and a permanently-disabled button is noise).
   */
  agentId?: string | null;
  /** Called by FindingsPanel (which owns the mutation) when the user clicks "Turn into eval case". */
  onCreateEvalCase?: (findingId: string) => void;
  /** True while FindingsPanel's createEvalCase mutation is pending for this finding. */
  isCreatingEvalCase?: boolean;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  const decided = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      {/* Not a <button>: the header holds a MonoLink, which renders an <a> (or a
          <button>) for the file:line deep-link, and interactive content inside a
          button is invalid HTML. Same role/tabIndex/onKeyDown shape as
          FindingsCell instead. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          // Only when the header itself holds focus — keydown bubbles, so
          // otherwise Enter on the file link would also collapse the card.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            if (e.key === " ") e.preventDefault(); // Space scrolls the page otherwise
            setExpanded((x) => !x);
          }
        }}
        style={s.header}
      >
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>

            {/* "Turn into eval case" — hidden when agentId is absent (Decision A).
                Disabled with tooltip reason when undecided (criterion 3).
                Mutation lives in FindingsPanel; wired via onCreateEvalCase callback. */}
            {agentId && (
              <span
                title={!decided ? t("finding.evalCaseDisabledReason") : undefined}
                style={{ display: "inline-flex" }}
              >
                <Button
                  kind="ghost"
                  size="sm"
                  icon="FlaskConical"
                  disabled={!decided || !!isCreatingEvalCase}
                  loading={!!isCreatingEvalCase}
                  onClick={() => {
                    if (decided) onCreateEvalCase?.(f.id);
                  }}
                >
                  {isCreatingEvalCase
                    ? t("finding.evalCaseCreating")
                    : t("finding.turnIntoEvalCase")}
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
