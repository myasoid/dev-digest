import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

/**
 * `activeKeyFor` had no test before this feature. Project Context is the
 * first nav entry this repo pins a test for — AC-46 depends on it returning
 * "context" for the N6 route.
 */
describe("activeKeyFor", () => {
  it("maps the Project Context route to the \"context\" nav key (AC-45, AC-46)", () => {
    expect(activeKeyFor("/repos/repo1/context")).toBe("context");
  });

  it("still maps every other route to its own key, unaffected by the new entry", () => {
    expect(activeKeyFor("/repos/repo1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/repo1/conventions")).toBe("conventions");
    expect(activeKeyFor("/skills")).toBe("skills");
    expect(activeKeyFor("/agents")).toBe("agents");
    expect(activeKeyFor("/settings/api-keys")).toBe("settings");
  });

  it("returns an empty string for an unmatched route", () => {
    expect(activeKeyFor("/nowhere")).toBe("");
  });
});
