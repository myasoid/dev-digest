import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import agentMessages from "../../../../../../messages/en/agents.json";
import evalMessages from "../../../../../../messages/en/eval.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// Mock the evals hooks so the EvalsTab renders without a real API.
vi.mock("../../../../../lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: [], isLoading: false }),
  useEvalRuns: () => ({ data: [] }),
  useEvalDashboard: () => ({ data: null }),
  useEvalSuiteRunDetail: () => ({ data: null, isLoading: false }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartEvalSuiteRun: () => ({ mutate: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const allMessages = { agents: agentMessages, eval: evalMessages };

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={allMessages}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders the Evals tab when ?tab=evals", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    // Tab label should be present in the tab bar
    expect(screen.getByText("Evals")).toBeInTheDocument();
    // The Evals tab body should render the cases heading and empty-state message
    expect(screen.getByText("Eval cases")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No eval cases yet. Create one to assert this agent's expected findings on a sample diff.",
      ),
    ).toBeInTheDocument();
  });

  it("switches to the Evals tab on click and resolves ?tab=evals", () => {
    const onTab = vi.fn();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);

    // Click the Evals tab button in the tab bar
    fireEvent.click(screen.getByText("Evals"));
    expect(onTab).toHaveBeenCalledWith("evals");
  });
});
