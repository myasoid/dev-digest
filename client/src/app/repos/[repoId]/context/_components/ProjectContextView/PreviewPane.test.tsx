import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { SpecFile } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

/**
 * R-6 (plan Recommendations): the vendored `Markdown` primitive
 * (`react-markdown` ^9, no `rehype-raw`) is expected to already strip raw
 * HTML and neutralize unsafe URL protocols. This proves that expectation
 * against a hostile, author-controlled document body flowing through THIS
 * feature's own preview path — not a change to `Markdown` itself
 * (`client/CLAUDE.md`: `src/vendor/ui` is do-not-touch).
 */
let docResult: {
  data: SpecFile | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};

vi.mock("@/lib/hooks", () => ({
  useContextDoc: () => docResult,
}));

import { PreviewPane } from "./PreviewPane";

afterEach(() => {
  cleanup();
});

function PreviewPaneHarness({ path }: { path: string | null }) {
  const t = useTranslations("context");
  return <PreviewPane t={t} repoId="repo-1" path={path} />;
}

function renderPane(path: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <PreviewPaneHarness path={path} />
    </NextIntlClientProvider>,
  );
}

describe("PreviewPane", () => {
  it("renders a hostile document's markdown without executing raw HTML or an unsafe link protocol (R-6)", () => {
    const hostileContent = [
      "# Hostile spec",
      "",
      '<script>window.__pwned = true;</script>',
      '<img src="x" onerror="window.__pwned = true">',
      "",
      "[click me](javascript:window.__pwned=true)",
    ].join("\n");
    docResult = {
      data: {
        path: "specs/hostile.md",
        type: "specs",
        content: hostileContent,
        size: hostileContent.length,
        updated_at: null,
        est_tokens: 10,
        used_by_agents: 0,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };

    const { container } = renderPane("specs/hostile.md");

    // No raw <script> or event-handler-bearing element reached the DOM —
    // react-markdown with no rehype-raw renders the tags as escaped text.
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img[onerror]")).not.toBeInTheDocument();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();

    // The link survives as text/an anchor, but never with a javascript: href.
    const link = screen.queryByRole("link", { name: /click me/i });
    if (link) {
      expect(link).not.toHaveAttribute("href", expect.stringMatching(/^javascript:/i));
    }
  });

  it("shows the placeholder when no document is selected, and its own error state on a failed read (AC-11 client side)", () => {
    docResult = { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    renderPane(null);
    expect(screen.getByText(messages.selectPrompt)).toBeInTheDocument();
    cleanup();

    const refetch = vi.fn();
    docResult = { data: undefined, isLoading: false, isError: true, error: new Error("boom"), refetch };
    renderPane("specs/broken.md");
    expect(screen.getByText(messages.doc.loadError)).toBeInTheDocument();
  });
});
