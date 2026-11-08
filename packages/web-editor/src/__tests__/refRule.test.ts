import { describe, it, expect } from "vitest";
import { isValidRef, sanitizeXmlId } from "../sectionUtils";
import fixture from "./fixtures/refs.json";

// The Rails app pins REF_REGEX against this same file (ContentTest), so the
// rule the editor enforces at the shared document's write boundary and the
// rule the rows enforce cannot drift apart without one suite failing.
describe("isValidRef", () => {
  it("accepts every ref the fixture calls valid", () => {
    for (const ref of fixture.valid) expect(isValidRef(ref), ref).toBe(true);
  });

  it("refuses every ref the fixture calls invalid", () => {
    for (const ref of fixture.invalid) expect(isValidRef(ref), JSON.stringify(ref)).toBe(false);
  });

  it("accepts whatever sanitizeXmlId produces, when it produces anything", () => {
    for (const raw of [...fixture.valid, ...fixture.invalid, "Chapter 1!", "9 lives", "ünïcode"]) {
      const sanitized = sanitizeXmlId(raw);
      if (sanitized !== "") expect(isValidRef(sanitized), raw).toBe(true);
    }
  });
});
