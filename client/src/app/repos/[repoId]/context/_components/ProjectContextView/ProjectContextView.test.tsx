import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SpecFile, SpecFileList } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../messages/en/context.json";

const reindexMutate = vi.fn();
let docsResult: {
  data: SpecFileList | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  dataUpdatedAt: number;
};

const DOCS: SpecFile[] = [
  { path: "specs/public-api.md", type: "specs", content: null, size: 400, updated_at: null, est_tokens: 100, used_by_agents: 1 },
  { path: "docs/guide.md", type: "docs", content: null, size: 800, updated_at: null, est_tokens: 200, used_by_agents: 0 },
];

vi.mock("@/lib/hooks", () => ({
  useContextFiles: () => docsResult,
  useReindexContext: () => ({ mutate: reindexMutate, isPending: false }),
  useContextDoc: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  reindexMutate.mockClear();
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView", () => {
  it("lists documents, selects one, and refresh triggers reindex — no edit/save/upload control anywhere (AC-7, AC-10, AC-12)", () => {
    docsResult = {
      data: { files: DOCS, truncated: false, shown: DOCS.length },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    };
    renderView();

    expect(screen.getByText("specs/public-api.md")).toBeInTheDocument();
    expect(screen.getByText("docs/guide.md")).toBeInTheDocument();
    expect(screen.getByText(/2 documents/)).toBeInTheDocument();

    // G-7/US-8: "Used by N agents" is rendered per document from `used_by_agents`.
    expect(screen.getByText("Used by 1 agent")).toBeInTheDocument();
    expect(screen.getByText("Used by 0 agents")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Re-index"));
    expect(reindexMutate).toHaveBeenCalledWith("repo-1");

    for (const forbidden of [/^edit$/i, /^save$/i, /^upload$/i, /^create$/i, /^delete$/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it("omits the usage count for a document where it is not known (G-7, US-8)", () => {
    const unknown: SpecFile[] = [
      { path: "specs/unknown.md", type: "specs", content: null, size: 100, updated_at: null, est_tokens: 25, used_by_agents: null },
    ];
    docsResult = {
      data: { files: unknown, truncated: false, shown: unknown.length },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    };
    renderView();
    expect(screen.getByText("specs/unknown.md")).toBeInTheDocument();
    expect(screen.queryByText(/Used by/)).not.toBeInTheDocument();
  });

  it("shows the empty state when a repository has no discoverable documents (AC-42)", () => {
    docsResult = {
      data: { files: [], truncated: false, shown: 0 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    };
    renderView();
    expect(screen.getByText("No spec files yet")).toBeInTheDocument();
  });

  it('shows the "showing N of many" signal when discovery hit the cap, and hides it otherwise (NFR-13)', () => {
    docsResult = {
      data: { files: DOCS, truncated: true, shown: DOCS.length },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    };
    renderView();
    expect(screen.getByText(/Showing the first 2 documents/)).toBeInTheDocument();

    cleanup();
    docsResult = {
      data: { files: DOCS, truncated: false, shown: DOCS.length },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    };
    renderView();
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it("shows the DISTINCT not-synced state, not the empty state, on a repo_not_synced error (AC-6)", () => {
    docsResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("not synced", 409, "repo_not_synced"),
      refetch: vi.fn(),
      dataUpdatedAt: 0,
    };
    renderView();
    expect(screen.getByText("Repository not synced yet")).toBeInTheDocument();
    expect(screen.queryByText("No spec files yet")).not.toBeInTheDocument();
  });

  it("shows a retryable error state for a generic discovery failure (AC-43)", () => {
    const refetch = vi.fn();
    docsResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("boom", 500, "internal_error"),
      refetch,
      dataUpdatedAt: 0,
    };
    renderView();
    expect(screen.getByText("Couldn’t load specs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
