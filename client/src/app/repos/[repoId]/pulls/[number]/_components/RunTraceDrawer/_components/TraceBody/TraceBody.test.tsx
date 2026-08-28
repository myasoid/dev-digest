import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const BASE: RunTrace = {
  config: { agent: "Security Reviewer", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 4200, tokens_in: 100, tokens_out: 50, cost_usd: 0.01, findings: 0, grounding: "0/0 passed" },
  intent_stats: null,
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: "# Rubric",
    memory: "- remembered fact",
    specs: "<untrusted source=\"spec-0\">\n# Public API\n</untrusted>",
    callers: "### callers digest",
    repo_map: "### repo skeleton",
    pr_description: null,
    intent: null,
    user: "Review the diff.",
    section_sizes: [],
  },
  tool_calls: [],
  raw_output: "",
  memory_pulled: [],
  specs_read: ["specs/public-api.md"],
  log: [],
};

function renderBody(trace: RunTrace) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <TraceBody trace={trace} findings={[]} />
    </NextIntlClientProvider>,
  );
}

/** The prompt-assembly section starts collapsed (`defaultOpen={false}`). */
function openPromptAssembly() {
  fireEvent.click(screen.getByRole("button", { name: /prompt assembly/i }));
}

describe("TraceBody — prompt assembly block order (AC-36, AC-38, AC-39)", () => {
  it("lists blocks in the engine's assembly order — skills, memory, repo skeleton, specs, callers, user — with the untrusted-specs label", () => {
    renderBody(BASE);
    openPromptAssembly();

    const labels = screen
      .getAllByRole("button", { name: /^(system|skills|memory|repo skeleton|project context|callers|user)/i })
      .map((btn) => btn.textContent);

    expect(labels).toEqual([
      expect.stringContaining("System"),
      expect.stringContaining("Skills"),
      expect.stringContaining("Memory"),
      expect.stringContaining("Repo skeleton"),
      expect.stringContaining("Project context — attached specs (untrusted)"),
      expect.stringContaining("Callers"),
      expect.stringContaining("User"),
    ]);
  });

  it("omits the project-context block entirely when specs is null, rather than rendering an empty one (AC-39)", () => {
    renderBody({ ...BASE, prompt_assembly: { ...BASE.prompt_assembly, specs: null } });
    openPromptAssembly();

    expect(screen.queryByText(/Project context — attached specs/i)).not.toBeInTheDocument();
    // Every other block still renders — this run just attached nothing.
    expect(screen.getByRole("button", { name: /^Skills/i })).toBeInTheDocument();
  });
});
