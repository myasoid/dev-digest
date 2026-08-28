/* OverviewTab.test.tsx — verifies that both IntentPanel and BlastPanel are
   rendered on the Overview tab side-by-side. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import intentMessages from "../../../../../../../../messages/en/intent.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";

// Mock the data hooks so the component renders without a real API. Both
// OverviewTab.tsx (relative import) and PrBriefCard.tsx (`@/` alias) resolve
// to this same module — Vitest matches by resolved file, so one factory
// covers both import specifiers.
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  usePrIntent: () => ({ data: undefined, isLoading: false }),
  useRefreshIntent: () => ({ mutate: vi.fn(), isPending: false }),
  usePrBrief: () => ({ data: undefined, isLoading: false }),
  useRefreshBrief: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePrReviews: () => ({ data: undefined }),
}));

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: vi.fn(() => ({ data: undefined, isLoading: true, isError: false })),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ blast: blastMessages, intent: intentMessages, brief: briefMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("OverviewTab — layout", () => {
  it("renders both IntentPanel and BlastPanel on the overview tab", () => {
    renderWithIntl(
      <OverviewTab
        prId="pr-1"
        prBody={null}
        headSha="abc123"
        repoFullName="acme/payments-api"
      />,
    );

    // IntentPanel uses t("title") = "Intent"
    expect(screen.getByText("Intent")).toBeInTheDocument();
    // BlastPanel uses t("title") = "Blast Radius"
    expect(screen.getByText("Blast Radius")).toBeInTheDocument();
  });

  it("does not render the PR body section when prBody is null", () => {
    renderWithIntl(
      <OverviewTab
        prId="pr-1"
        prBody={null}
        headSha="abc123"
        repoFullName="acme/payments-api"
      />,
    );

    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  it("renders the PR body section when prBody is provided", () => {
    renderWithIntl(
      <OverviewTab
        prId="pr-1"
        prBody="This PR fixes the rate limiter."
        headSha="abc123"
        repoFullName="acme/payments-api"
      />,
    );

    expect(screen.getByText("This PR fixes the rate limiter.")).toBeInTheDocument();
  });
});
