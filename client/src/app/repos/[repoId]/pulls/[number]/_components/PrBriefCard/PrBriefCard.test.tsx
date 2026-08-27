/* PrBriefCard.test.tsx — RTL tests for the card's required states/behaviours:
   AC-4  stale indicator when brief.head_sha !== headSha
   AC-9  review_focus links pinned to the brief's stored head_sha, not headSha
   AC-10 risk_level rendered as text (not colour-only)
   AC-13 partial-inputs indicator
   AC-14 no-brief-yet empty state with a Generate control
   EC-6  empty review_focus[] is distinct from no-brief-yet and from partial
   EC-9  risks[] renders independently of review_focus[] */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(),
}));

import { usePrReviews } from "@/lib/hooks/reviews";
import { PrBriefCard } from "./PrBriefCard";

const mockUsePrReviews = vi.mocked(usePrReviews);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BRIEF_HEAD_SHA = "brief0sha1111";
const PR_HEAD_SHA = "current0sha2222"; // deliberately different from BRIEF_HEAD_SHA

function makeBrief(overrides: Partial<PrBrief> = {}): PrBrief {
  return {
    what: "Adds rate limiting to the refresh route.",
    why: "Prevent abuse of an AI-generation endpoint.",
    risk_level: "medium",
    risks: [],
    review_focus: [],
    signals_used: ["diff_shape", "intent", "blast"],
    head_sha: BRIEF_HEAD_SHA,
    ...overrides,
  };
}

function noReviews() {
  mockUsePrReviews.mockReturnValue({ data: undefined } as ReturnType<typeof usePrReviews>);
}

function baseProps(overrides: Partial<React.ComponentProps<typeof PrBriefCard>> = {}) {
  return {
    prId: "pr-1",
    brief: undefined,
    isLoading: false,
    headSha: PR_HEAD_SHA,
    repoFullName: "acme/payments-api",
    onGenerate: vi.fn(),
    generating: false,
    generateError: false,
    ...overrides,
  };
}

describe("PrBriefCard — no brief yet (AC-14)", () => {
  it("shows an empty state with a Generate control, distinct from loading and from an empty review_focus", () => {
    noReviews();
    const onGenerate = vi.fn();

    renderWithIntl(<PrBriefCard {...baseProps({ brief: null, onGenerate })} />);

    expect(screen.getByText(/no brief yet/i)).toBeInTheDocument();
    const generateBtn = screen.getByRole("button", { name: /generate brief/i });
    fireEvent.click(generateBtn);
    expect(onGenerate).toHaveBeenCalledTimes(1);

    // Not the same message as an empty (but generated) review_focus list.
    expect(screen.queryByText(/nothing rose to read-first/i)).not.toBeInTheDocument();
  });

  it("shows a loading skeleton, not the empty state, while the cached GET is pending", () => {
    noReviews();
    renderWithIntl(<PrBriefCard {...baseProps({ brief: undefined, isLoading: true })} />);

    expect(screen.queryByText(/no brief yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate brief/i })).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — generated brief", () => {
  it("renders risk_level as text (AC-10), what/why, and independent risks[]/review_focus[] sections (EC-9)", () => {
    noReviews();
    const brief = makeBrief({
      risk_level: "high",
      risks: [{ title: "Untested boundary", explanation: "No test covers the edge.", refs: ["src/a.ts"] }],
      review_focus: [],
    });

    renderWithIntl(<PrBriefCard {...baseProps({ brief })} />);

    // risk_level conveyed by visible text, not only a colour swatch.
    expect(screen.getByText(/high risk/i)).toBeInTheDocument();
    expect(screen.getByText(brief.what)).toBeInTheDocument();
    expect(screen.getByText(brief.why)).toBeInTheDocument();

    // A risk renders even though review_focus is empty — independent lists.
    expect(screen.getByText("Untested boundary")).toBeInTheDocument();
    expect(screen.getByText(/nothing rose to read-first/i)).toBeInTheDocument();
  });

  it("EC-6 — empty review_focus reads as a generated answer, not as 'no brief yet' or partial", () => {
    noReviews();
    const brief = makeBrief({ review_focus: [], signals_used: ["diff_shape", "intent", "blast"] });

    renderWithIntl(<PrBriefCard {...baseProps({ brief })} />);

    expect(screen.getByText(/nothing rose to read-first/i)).toBeInTheDocument();
    expect(screen.queryByText(/no brief yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/partial/i)).not.toBeInTheDocument();
  });

  it("AC-9 — review_focus links are pinned to the brief's stored head_sha, not the PR's current headSha", () => {
    noReviews();
    const brief = makeBrief({
      head_sha: BRIEF_HEAD_SHA,
      review_focus: [{ ref: "src/rate-limit.ts", line: 42, description: "The new refresh route." }],
    });

    renderWithIntl(<PrBriefCard {...baseProps({ brief, headSha: PR_HEAD_SHA })} />);

    const link = screen.getByRole("link", { name: /rate-limit\.ts/i });
    expect(link).toHaveAttribute("href", expect.stringContaining(BRIEF_HEAD_SHA));
    expect(link.getAttribute("href")).not.toContain(PR_HEAD_SHA);
    // A real <a>, so it is keyboard-focusable without extra wiring.
    expect(link.tagName).toBe("A");
  });

  it("AC-4 — shows a stale indicator when brief.head_sha differs from the PR's current headSha", () => {
    noReviews();
    const stale = makeBrief({ head_sha: BRIEF_HEAD_SHA });
    renderWithIntl(<PrBriefCard {...baseProps({ brief: stale, headSha: PR_HEAD_SHA })} />);
    expect(screen.getByText(/new commits landed/i)).toBeInTheDocument();

    cleanup();
    const fresh = makeBrief({ head_sha: PR_HEAD_SHA });
    renderWithIntl(<PrBriefCard {...baseProps({ brief: fresh, headSha: PR_HEAD_SHA })} />);
    expect(screen.queryByText(/new commits landed/i)).not.toBeInTheDocument();
  });

  it("AC-13 — shows a partial-inputs indicator when the brief was generated without Intent or Blast", () => {
    noReviews();
    const partial = makeBrief({ signals_used: ["diff_shape"] });
    renderWithIntl(<PrBriefCard {...baseProps({ brief: partial })} />);
    expect(screen.getByText(/partial inputs/i)).toBeInTheDocument();

    cleanup();
    const full = makeBrief({ signals_used: ["diff_shape", "intent", "blast"] });
    renderWithIntl(<PrBriefCard {...baseProps({ brief: full })} />);
    expect(screen.queryByText(/partial inputs/i)).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — error state", () => {
  it("shows a retry affordance and the card persists (does not disappear) when generation failed", () => {
    noReviews();
    const onGenerate = vi.fn();

    renderWithIntl(<PrBriefCard {...baseProps({ brief: null, generateError: true, onGenerate })} />);

    expect(screen.getByText(/could not generate the brief/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});
