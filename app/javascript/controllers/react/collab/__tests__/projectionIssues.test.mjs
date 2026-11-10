import { describe, it, expect } from "vitest";
import { describeProjectionIssue, sameProjectionIssues } from "../projectionIssues.js";

describe("describeProjectionIssue", () => {
  it("names the record by its ID and gives the reason", () => {
    expect(
      describeProjectionIssue({ kind: "division", id: "abc", ref: "sec-chapter 1 ", reason: 'ref "sec-chapter 1 " is invalid' }),
    ).toBe('Division with ID “sec-chapter 1 ”: ref "sec-chapter 1 " is invalid.');
  });

  it("falls back to the id when the record has no ref at all", () => {
    expect(
      describeProjectionIssue({ kind: "asset", id: "88888888-8888-4888-8888-888888888888", ref: null, reason: "ref is missing" }),
    ).toBe("Image (ID 88888888…): ref is missing.");
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
