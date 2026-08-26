import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocLink, Skill, SpecFile } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";

const setPaths = vi.fn();

const DOCS: SpecFile[] = [
  { path: "specs/public-api.md", type: "specs", content: null, size: 400, updated_at: null, est_tokens: 100, used_by_agents: 0 },
];
const LINKS: ContextDocLink[] = [{ owner_kind: "skill", owner_id: "s1", path: "specs/public-api.md", order: 0 }];

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "repo1" }) }));
vi.mock("@/lib/hooks", () => ({
  useContextFiles: () => ({
    data: { files: DOCS, truncated: false, shown: DOCS.length },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSkillContextDocs: () => ({ data: LINKS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetSkillContextDocs: () => ({ mutate: setPaths, isPending: false }),
  useContextDoc: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setPaths.mockClear();
});

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when scoring a PR.",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 1,
  evidence_files: null,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("SkillDetail ContextTab", () => {
  it("shows the skill-flavour attached badge and detaches a document via the shared panel", () => {
    renderTab();
    expect(screen.getByText("1 attached")).toBeInTheDocument();

    const row = screen.getByRole("listitem", { name: "specs/public-api.md" });
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(setPaths).toHaveBeenCalledWith({ skillId: "s1", paths: [], repoId: "repo1" });
  });

  it("renders the manifest preview naming the real heading and the attached path, in injection order (AC-40, AC-41)", () => {
    renderTab();
    expect(screen.getByText("## Project context")).toBeInTheDocument();
    // Appears twice: once in the attach row, once in the manifest preview below it.
    expect(screen.getAllByText("specs/public-api.md")).toHaveLength(2);
    expect(
      screen.getByText(
        "The real `## Project context` heading. Each document below is injected in full inside its own untrusted block.",
      ),
    ).toBeInTheDocument();
  });
});
