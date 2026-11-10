import { describe, it, expect } from "vitest";
import {
  describeInvariantViolation,
  incidentDetailFor,
  incidentKindFor,
} from "../invariantNotices.js";

const refused = {
  kind: "invalid_ref",
  record: "division",
  id: "d1",
  ref: "sec-chapter 1",
  operation: "localDivisionAdd",
  stack: "Error\n    at localDivisionAdd (bridge.ts:1:1)",
};
const repaired = {
  kind: "duplicate_ref",
  record: "division",
  id: "d2",
  ref: "offline-test",
  renamedTo: "offline-test-2",
};

describe("incidentKindFor", () => {
  it("maps a refused write to malformed_record and a repair to duplicate_ref", () => {
    expect(incidentKindFor(refused)).toBe("malformed_record");
    expect(incidentKindFor(repaired)).toBe("duplicate_ref");
  });
});

describe("incidentDetailFor", () => {
  it("puts the fields first and the stack last, so truncation keeps the fields", () => {
    const detail = incidentDetailFor(refused);
    expect(detail.startsWith('{"kind":"invalid_ref"')).toBe(true);
    expect(detail.endsWith("bridge.ts:1:1)")).toBe(true);
    expect(JSON.parse(detail.split("\n")[0]).ref).toBe("sec-chapter 1");
  });

  it("is plain JSON when there is no stack", () => {
    expect(JSON.parse(incidentDetailFor(repaired))).toEqual(repaired);
  });
});

describe("describeInvariantViolation", () => {
  it("tells the author about a renamed division", () => {
    expect(describeInvariantViolation(repaired)).toContain("“offline-test”");
    expect(describeInvariantViolation(repaired)).toContain("“offline-test-2”");
    expect(describeInvariantViolation(repaired)).toContain("unused divisions");
  });

  it("says nothing about a refused write, which changed nothing the author sees", () => {
    expect(describeInvariantViolation(refused)).toBeNull();
  });
});
