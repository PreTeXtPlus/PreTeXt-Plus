import { describe, it, expect } from "vitest";
import { describeProjectionIssue, sameProjectionIssues } from "../projectionIssues.js";

describe("describeProjectionIssue", () => {
  it("names the record by its ID and gives the reason", () => {
    expect(
      describeProjectionIssue({ kind: "division", id: "abc", ref: "sec-chapter 1 ", reason: "Its ID isn't valid" }),
    ).toBe("Division “sec-chapter 1 ”: Its ID isn't valid.");
  });

  it("says so when the record has no ID at all, rather than showing its internal id", () => {
    expect(
      describeProjectionIssue({ kind: "asset", id: "88888888-8888-4888-8888-888888888888", ref: null, reason: "It needs an ID" }),
    ).toBe("Image with no ID: It needs an ID.");
  });
});

describe("sameProjectionIssues", () => {
  const a = [{ kind: "division", id: "1", ref: "x", reason: "r" }];

  it("treats the same records with the same reasons as the same report", () => {
    expect(sameProjectionIssues(a, [{ ...a[0] }])).toBe(true);
    expect(sameProjectionIssues([], [])).toBe(true);
  });

  it("treats a changed list as a new report", () => {
    expect(sameProjectionIssues(a, [])).toBe(false);
    expect(sameProjectionIssues(a, [{ ...a[0], reason: "other" }])).toBe(false);
    expect(sameProjectionIssues(null, a)).toBe(false);
  });
});
