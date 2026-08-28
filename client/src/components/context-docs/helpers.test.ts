import { describe, it, expect } from "vitest";
import type { ContextDocLink, SpecFile } from "@devdigest/shared";
import {
  arrangeDocs,
  attachedPathsInOrder,
  estTokens,
  filterDocs,
  moveItem,
  tokenTier,
} from "./helpers";

function doc(path: string, overrides: Partial<SpecFile> = {}): SpecFile {
  return {
    path,
    type: path.startsWith("docs/") ? "docs" : path.startsWith("insights/") ? "insights" : "specs",
    content: null,
    size: 400,
    updated_at: "2026-06-01T00:00:00Z",
    est_tokens: 100,
    used_by_agents: 0,
    ...overrides,
  };
}

function link(path: string, order: number): ContextDocLink {
  return { owner_kind: "agent", owner_id: "a1", path, order };
}

describe("arrangeDocs", () => {
  it("orders attached documents first, in stored order, then the rest by path", () => {
    const docs = [doc("specs/z.md"), doc("specs/a.md"), doc("docs/b.md")];
    const links = [link("docs/b.md", 0), link("specs/z.md", 1)];
    const arranged = arrangeDocs(docs, links);
    expect(arranged.map((d) => d.path)).toEqual(["docs/b.md", "specs/z.md", "specs/a.md"]);
    expect(arranged.every((d) => !d.missing)).toBe(true);
  });

  it("synthesizes a missing row for an attached path absent from the repo list (EC-13, AC-18)", () => {
    const docs = [doc("specs/present.md")];
    const links = [link("specs/present.md", 0), link("specs/deleted.md", 1)];
    const arranged = arrangeDocs(docs, links);
    const missing = arranged.find((d) => d.path === "specs/deleted.md");
    expect(missing?.missing).toBe(true);
    expect(missing?.type).toBe("specs");
  });
});

describe("moveItem", () => {
  it("moves an item to a new index without mutating the input", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("returns the same list for an out-of-range or no-op move", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 0, 0)).toBe(list);
    expect(moveItem(list, -1, 1)).toBe(list);
  });
});

describe("attachedPathsInOrder", () => {
  it("returns only attached paths, in the arranged order", () => {
    const arranged = arrangeDocs(
      [doc("specs/a.md"), doc("specs/b.md")],
      [link("specs/b.md", 0)],
    );
    expect(attachedPathsInOrder(arranged, new Set(["specs/b.md"]))).toEqual(["specs/b.md"]);
  });
});

describe("filterDocs", () => {
  it("filters case-insensitively over the repository-relative path (AC-19)", () => {
    const docs = [
      { ...doc("specs/Public-API.md"), missing: false },
      { ...doc("docs/guide.md"), missing: false },
    ];
    expect(filterDocs(docs, "public").map((d) => d.path)).toEqual(["specs/Public-API.md"]);
    expect(filterDocs(docs, "").map((d) => d.path)).toEqual(["specs/Public-API.md", "docs/guide.md"]);
  });
});

describe("estTokens", () => {
  it("sums est_tokens for attached, non-missing rows only (AC-22)", () => {
    const docs = arrangeDocs(
      [doc("specs/a.md", { est_tokens: 100 }), doc("specs/b.md", { est_tokens: 250 })],
      [link("specs/a.md", 0), link("specs/missing.md", 1)],
    );
    // "specs/missing.md" is attached but not in the repo's document list, so
    // arrangeDocs synthesizes it as a missing row — excluded from the total
    // even though it's in the `attached` set. "specs/b.md" is in the repo's
    // document list but NOT attached, so it's excluded too.
    expect(estTokens(docs, new Set(["specs/a.md", "specs/missing.md"]))).toBe(100);
  });

  it("attaching stays possible regardless of total (AC-25) — estTokens never throws or caps", () => {
    const docs = arrangeDocs([doc("specs/a.md", { est_tokens: 1_000_000 })], [link("specs/a.md", 0)]);
    expect(estTokens(docs, new Set(["specs/a.md"]))).toBe(1_000_000);
  });
});

describe("tokenTier", () => {
  it("is ok below 25,000, amber at/above it, red at/above 50,000", () => {
    expect(tokenTier(0)).toBe("ok");
    expect(tokenTier(24_999)).toBe("ok");
    expect(tokenTier(25_000)).toBe("amber");
    expect(tokenTier(49_999)).toBe("amber");
    expect(tokenTier(50_000)).toBe("red");
  });
});
