/* BlastPanel.test.tsx — RTL tests for the four required acceptance scenarios:
   1. Truncated caller count reads "20 of 47 callers", not a bare "20"
   2. Status banner renders explanation for both 'partial' and 'degraded'
   3. ok + zero symbols → clean empty state (not an error)
   4. Caller link href contains indexedSha, not the PR head_sha */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBlastMap } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";

// Mock the hook before importing the component so the mock is hoisted correctly.
vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: vi.fn(),
}));

import { useBlastRadius } from "@/lib/hooks/blast";
import { BlastPanel } from "./BlastPanel";

const mockUseBlastRadius = vi.mocked(useBlastRadius);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Provider wrapper — required because BlastPanel uses useTranslations("blast")
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INDEXED_SHA = "aabbccdd1122";
const HEAD_SHA = "deadbeef9999"; // deliberately different from INDEXED_SHA

function makeBlast(overrides: Partial<PrBlastMap> = {}): PrBlastMap {
  return {
    status: "ok",
    explanation: null,
    reason: null,
    indexedSha: INDEXED_SHA,
    stale: false,
    symbols: [],
    symbolsTruncated: false,
    endpoints: [],
    crons: [],
    priorPrs: [],
    counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    ...overrides,
  };
}

/** A symbol with 20 callers visible but 47 total (truncated). */
const TRUNCATED_SYMBOL: PrBlastMap["symbols"][0] = {
  file: "src/payments/processor.ts",
  name: "processPayment",
  kind: "function",
  callers: Array.from({ length: 20 }, (_, i) => ({
    file: `src/handlers/handler_${i}.ts`,
    symbol: `handle_${i}`,
    viaSymbol: "processPayment",
    line: i + 1,
    rank: 100 - i,
  })),
  callerCount: 47,
  truncated: true,
};

/** A symbol with 3 callers and no truncation. */
const NORMAL_SYMBOL: PrBlastMap["symbols"][0] = {
  file: "src/payments/formatter.ts",
  name: "formatAmount",
  kind: "function",
  callers: [
    { file: "src/ui/invoice.ts", symbol: "renderInvoice", viaSymbol: "formatAmount", line: 22, rank: 90 },
    { file: "src/ui/receipt.ts", symbol: "renderReceipt", viaSymbol: "formatAmount", line: 8, rank: 80 },
    { file: "src/api/export.ts", symbol: "exportCsv", viaSymbol: "formatAmount", line: 55, rank: 70 },
  ],
  callerCount: 3,
  truncated: false,
};

function queryReturning(blast: PrBlastMap) {
  mockUseBlastRadius.mockReturnValue({
    data: blast,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useBlastRadius>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BlastPanel — truncated caller count", () => {
  it('shows "20 of 47 callers" when the caller list is capped, not a bare "20"', () => {
    queryReturning(
      makeBlast({
        symbols: [TRUNCATED_SYMBOL],
        counts: { symbols: 1, callers: 20, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    // The header of the symbol row should display the truncated label.
    expect(screen.getByText(/20 of 47 callers/i)).toBeInTheDocument();
    // It must NOT display a bare "20 callers" without the total.
    expect(screen.queryByText(/^20 callers$/i)).not.toBeInTheDocument();
  });

  it("shows truncation note inside the expanded caller list", () => {
    queryReturning(
      makeBlast({
        symbols: [TRUNCATED_SYMBOL],
        counts: { symbols: 1, callers: 20, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    // Expand the symbol row to see callers
    const expandBtn = screen.getByRole("button", { name: /processPayment/i });
    fireEvent.click(expandBtn);

    // The truncation footnote inside the expanded list
    expect(screen.getByText(/Showing 20 of 47 callers/i)).toBeInTheDocument();
  });

  it("shows bare count for a non-truncated symbol", () => {
    queryReturning(
      makeBlast({
        symbols: [NORMAL_SYMBOL],
        counts: { symbols: 1, callers: 3, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    // Non-truncated: just "3 callers", no "of N"
    expect(screen.getByText(/3 callers/i)).toBeInTheDocument();
    expect(screen.queryByText(/of \d/)).not.toBeInTheDocument();
  });
});

describe("BlastPanel — status banner", () => {
  it("renders explanation verbatim for status=partial", () => {
    queryReturning(
      makeBlast({
        status: "partial",
        explanation:
          "The index is 4 commits behind this PR's head; callers are resolved against aabbccdd1122.",
        stale: true,
        symbols: [NORMAL_SYMBOL],
        counts: { symbols: 1, callers: 3, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("4 commits behind");
  });

  it("renders explanation verbatim for status=degraded", () => {
    queryReturning(
      makeBlast({
        status: "degraded",
        explanation:
          "The repo-intel index is disabled. Results come from a grep fallback and may be incomplete.",
        reason: "flag_off",
        symbols: [],
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("grep fallback");
  });

  it("does NOT render a status banner when status=ok", () => {
    queryReturning(
      makeBlast({
        status: "ok",
        symbols: [NORMAL_SYMBOL],
        counts: { symbols: 1, callers: 3, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("BlastPanel — ok + zero symbols empty state", () => {
  it("shows a clear success message, not an error, when nothing was found", () => {
    queryReturning(
      makeBlast({
        status: "ok",
        symbols: [],
        counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    // Should communicate "nothing found" positively
    expect(screen.getByText(/no downstream impact found/i)).toBeInTheDocument();
    // Must NOT look like a failure
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });
});

describe("BlastPanel — caller link SHA", () => {
  it("links caller file:line to indexedSha, not to head_sha", () => {
    queryReturning(
      makeBlast({
        status: "ok",
        indexedSha: INDEXED_SHA,
        symbols: [NORMAL_SYMBOL],
        counts: { symbols: 1, callers: 3, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    // Expand the symbol to reveal caller links
    const expandBtn = screen.getByRole("button", { name: /formatAmount/i });
    fireEvent.click(expandBtn);

    // Find caller links — each renders as "file:line"
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      // Must contain the indexed SHA
      expect(href).toContain(INDEXED_SHA);
      // Must NOT contain the PR head SHA (it is a different commit)
      expect(href).not.toContain(HEAD_SHA);
    }
  });

  it("renders caller as plain text when indexedSha is null", () => {
    queryReturning(
      makeBlast({
        status: "partial",
        explanation: "Index not available.",
        indexedSha: null,
        symbols: [NORMAL_SYMBOL],
        counts: { symbols: 1, callers: 3, endpoints: 0, crons: 0 },
      }),
    );

    renderWithIntl(<BlastPanel prId="pr-1" repoFullName="acme/payments-api" />);

    // Expand the symbol
    const expandBtn = screen.getByRole("button", { name: /formatAmount/i });
    fireEvent.click(expandBtn);

    // With no indexedSha, MonoLink renders as a <button>, not an <a>.
    // There should be no <a> links (only the expand button itself).
    const links = screen.queryAllByRole("link");
    expect(links).toHaveLength(0);
  });
});
