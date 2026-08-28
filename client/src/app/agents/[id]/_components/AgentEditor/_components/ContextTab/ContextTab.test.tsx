import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, ContextDocLink, SpecFile } from "@devdigest/shared";
import contextMessages from "../../../../../../../../messages/en/context.json";

const setPaths = vi.fn();

const DOCS: SpecFile[] = [
  { path: "specs/public-api.md", type: "specs", content: null, size: 400, updated_at: null, est_tokens: 100, used_by_agents: 0 },
];
const LINKS: ContextDocLink[] = [];

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "repo1" }) }));
vi.mock("@/lib/hooks", () => ({
  useContextFiles: () => ({
    data: { files: DOCS, truncated: false, shown: DOCS.length },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAgentContextDocs: () => ({ data: LINKS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentContextDocs: () => ({ mutate: setPaths, isPending: false }),
  useContextDoc: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setPaths.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "sys",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

describe("AgentEditor ContextTab", () => {
  it("attaches a document to this agent, in the active repository, via the shared panel", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <ContextTab agent={AGENT} />
      </NextIntlClientProvider>,
    );

    const row = screen.getByRole("listitem", { name: "specs/public-api.md" });
    fireEvent.click(within(row).getByRole("checkbox"));

    expect(setPaths).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/public-api.md"],
      repoId: "repo1",
    });
  });
});
