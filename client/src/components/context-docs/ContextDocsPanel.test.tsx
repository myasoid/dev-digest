import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocLink, SpecFile } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";

const setPaths = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks", () => ({
  useContextDoc: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
}));

import { ContextDocsPanel } from "./ContextDocsPanel";

afterEach(() => {
  cleanup();
  setPaths.mockClear();
});

const DOCS: SpecFile[] = [
  { path: "specs/public-api.md", type: "specs", content: null, size: 400, updated_at: null, est_tokens: 100, used_by_agents: 2 },
  { path: "docs/guide.md", type: "docs", content: null, size: 800, updated_at: null, est_tokens: 200, used_by_agents: 0 },
];

const LINKS: ContextDocLink[] = [{ owner_kind: "agent", owner_id: "ag1", path: "docs/guide.md", order: 0 }];

function renderPanel(overrides: Partial<React.ComponentProps<typeof ContextDocsPanel>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextDocsPanel
        variant="agent"
        repoId="repo1"
        docs={DOCS}
        docsLoading={false}
        docsError={false}
        onRetryDocs={vi.fn()}
        links={LINKS}
        linksLoading={false}
        linksError={false}
        onRetryLinks={vi.fn()}
        onSetPaths={setPaths}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("ContextDocsPanel", () => {
  it("lists every repo document, shows the attached count, and toggling sends the new set in visual order", () => {
    renderPanel();
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((r) => r.getAttribute("aria-label"))).toEqual([
      "docs/guide.md",
      "specs/public-api.md",
    ]);

    const row = screen.getByRole("listitem", { name: "specs/public-api.md" });
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(setPaths).toHaveBeenCalledWith(["docs/guide.md", "specs/public-api.md"]);
  });

  it("shows a zero-attached badge with the full list rather than an error or a blank panel (AC-44)", () => {
    renderPanel({ links: [] });
    expect(screen.getByText("0 of 2 attached")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks an attached-but-absent document as missing, still detachable (AC-18)", () => {
    renderPanel({ links: [...LINKS, { owner_kind: "agent", owner_id: "ag1", path: "specs/deleted.md", order: 1 }] });
    const missingRow = screen.getByRole("listitem", { name: "specs/deleted.md" });
    expect(within(missingRow).getByRole("checkbox")).toBeChecked();

    fireEvent.click(within(missingRow).getByRole("checkbox"));
    expect(setPaths).toHaveBeenCalledWith(["docs/guide.md"]);
  });

  it("disables reordering while a filter narrows the list, and shows an error state with retry", () => {
    const { unmount } = renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "guide" } });
    expect(
      screen.getAllByRole("button", { name: /^Reorder /i }).every((h) => (h as HTMLButtonElement).disabled),
    ).toBe(true);
    unmount();

    const onRetryDocs = vi.fn();
    const onRetryLinks = vi.fn();
    renderPanel({ docsError: true, onRetryDocs, onRetryLinks });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetryDocs).toHaveBeenCalled();
    expect(onRetryLinks).toHaveBeenCalled();
  });
});
