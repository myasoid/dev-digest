import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./helpers";

describe("formatRelativeTime", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it("renders sub-minute deltas as just now", () => {
    expect(formatRelativeTime("2026-08-25T11:59:45Z", now)).toBe("just now");
  });

  it("renders minutes, hours and days once each threshold is crossed", () => {
    expect(formatRelativeTime("2026-08-25T11:55:00Z", now)).toBe("5m ago");
    expect(formatRelativeTime("2026-08-25T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-08-23T12:00:00Z", now)).toBe("2d ago");
  });

  it("never reports a negative delta as just now (a clock skew, not an error)", () => {
    expect(formatRelativeTime("2026-08-25T12:05:00Z", now)).toBe("just now");
  });
});
