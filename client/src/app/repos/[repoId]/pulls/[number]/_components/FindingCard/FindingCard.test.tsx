import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const ACCEPTED_FINDING: FindingRecord = { ...FINDING, id: "f2", accepted_at: "2026-08-29T12:00:00Z" };
const DISMISSED_FINDING: FindingRecord = { ...FINDING, id: "f3", dismissed_at: "2026-08-29T12:00:00Z" };

const allMessages = { prReview: prReviewMessages, eval: evalMessages };

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={allMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case (criterion 3, Decision A)", () => {
  it("hides the 'Turn into eval case' button when agentId is absent (Decision A)", () => {
    // No agentId prop → button is hidden entirely
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });

  it("shows the button disabled with tooltip when finding is undecided and agentId is present", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded agentId="ag1" />);
    const btn = screen.getByText("Turn into eval case").closest("button");
    expect(btn).toBeDisabled();
    // The wrapping span carries the tooltip reason
    const wrapper = screen.getByTitle(
      "Decide on this finding first (accept or dismiss) before creating an eval case.",
    );
    expect(wrapper).toBeInTheDocument();
  });

  it("shows the button enabled when finding is accepted and agentId is present", () => {
    renderWithIntl(<FindingCard f={ACCEPTED_FINDING} defaultExpanded agentId="ag1" />);
    const btn = screen.getByText("Turn into eval case").closest("button");
    expect(btn).not.toBeDisabled();
  });

  it("shows the button enabled when finding is dismissed and agentId is present", () => {
    renderWithIntl(<FindingCard f={DISMISSED_FINDING} defaultExpanded agentId="ag1" />);
    const btn = screen.getByText("Turn into eval case").closest("button");
    expect(btn).not.toBeDisabled();
  });
});
