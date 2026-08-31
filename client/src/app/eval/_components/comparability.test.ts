/* comparability.test.ts — hermetic unit tests for the comparability() helper.
   Plan Step 26 — criterion 9, 11. */

import { describe, it, expect } from "vitest";
import { comparability } from "./comparability";
import type { EvalRunInputs } from "@devdigest/shared";

const base: EvalRunInputs = {
  agent_version: 7,
  skill_versions: [
    { skill_id: "skill-a", version: 3 },
    { skill_id: "skill-b", version: 1 },
  ],
  case_set_revision: "abc123",
};

function inputs(overrides: Partial<EvalRunInputs> = {}): EvalRunInputs {
  return { ...base, ...overrides };
}

describe("comparability()", () => {
  it("returns like-for-like when all three inputs are equal", () => {
    expect(comparability(inputs(), inputs())).toEqual({ kind: "like-for-like" });
  });

  it("returns like-for-like when agent_version differs but skills and case_set are equal", () => {
    // Two different agent versions that happen to have identical skill pinnings
    // and the same case set are like-for-like by the rules (prompt diff is shown).
    expect(
      comparability(inputs({ agent_version: 6 }), inputs({ agent_version: 7 })),
    ).toEqual({ kind: "like-for-like" });
  });

  it("returns skills-changed when skill_versions differ at same case_set_revision", () => {
    const a = inputs();
    const b = inputs({
      skill_versions: [
        { skill_id: "skill-a", version: 4 }, // bumped
        { skill_id: "skill-b", version: 1 },
      ],
    });
    expect(comparability(a, b)).toEqual({ kind: "skills-changed" });
  });

  it("returns skills-changed when a skill is added", () => {
    const a = inputs();
    const b = inputs({
      skill_versions: [
        { skill_id: "skill-a", version: 3 },
        { skill_id: "skill-b", version: 1 },
        { skill_id: "skill-c", version: 1 },
      ],
    });
    expect(comparability(a, b)).toEqual({ kind: "skills-changed" });
  });

  it("returns skills-changed when a skill is removed", () => {
    const a = inputs();
    const b = inputs({ skill_versions: [{ skill_id: "skill-a", version: 3 }] });
    expect(comparability(a, b)).toEqual({ kind: "skills-changed" });
  });

  it("skill comparison is order-insensitive", () => {
    const a = inputs({
      skill_versions: [
        { skill_id: "skill-b", version: 1 },
        { skill_id: "skill-a", version: 3 },
      ],
    });
    const b = inputs({
      skill_versions: [
        { skill_id: "skill-a", version: 3 },
        { skill_id: "skill-b", version: 1 },
      ],
    });
    expect(comparability(a, b)).toEqual({ kind: "like-for-like" });
  });

  it("returns case-set-changed when case_set_revision differs", () => {
    const a = inputs();
    const b = inputs({ case_set_revision: "def456" });
    expect(comparability(a, b)).toEqual({ kind: "case-set-changed" });
  });

  it("case-set-changed takes precedence over skills-changed (rule priority)", () => {
    // Both the case set and skill versions differ — case set wins (criterion 11)
    const a = inputs();
    const b = inputs({
      case_set_revision: "different",
      skill_versions: [{ skill_id: "skill-z", version: 9 }],
    });
    expect(comparability(a, b)).toEqual({ kind: "case-set-changed" });
  });

  it("empty skill arrays are equal", () => {
    const a = inputs({ skill_versions: [] });
    const b = inputs({ skill_versions: [] });
    expect(comparability(a, b)).toEqual({ kind: "like-for-like" });
  });
});
