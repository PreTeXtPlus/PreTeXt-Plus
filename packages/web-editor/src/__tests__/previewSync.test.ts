import { describe, it, expect } from "vitest";
import { buildPreviewLineMap } from "../components/previewSync";

/**
 * A division as the editor holds it, and as assembly renders it: the same
 * lines, with a wrapper inserted around them and a `<plus:* ref/>` placeholder
 * replaced by the division it names.
 */
const EDITOR = [
  '<section xml:id="s">', // 1
  "<title>S</title>", // 2
  "<p>Intro.</p>", // 3
  "", // 4
  '<plus:subsection ref="ss"/>', // 5
  "<p>Outro.</p>", // 6
  "</section>", // 7
].join("\n");

const ASSEMBLED = [
  "<pretext>", // 1
  "<article>", // 2
  '<section xml:id="s">', // 3
  "<title>S</title>", // 4
  "<p>Intro.</p>", // 5
  '<subsection xml:id="ss">', // 6
  "<title>SS</title>", // 7
  "</subsection>", // 8
  "<p>Outro.</p>", // 9
  "</section>", // 10
  "</article>", // 11
  "</pretext>", // 12
].join("\n");

describe("buildPreviewLineMap", () => {
  const map = buildPreviewLineMap(EDITOR, ASSEMBLED);

  it("maps the division's own lines through the inserted wrapper", () => {
    expect(map.toAssembled(1)).toBe(3);
    expect(map.toAssembled(6)).toBe(9);
    expect(map.toEditor(9)).toBe(6);
  });

  it("leaves a rewritten placeholder line unmapped", () => {
    expect(map.toAssembled(5)).toBeUndefined();
  });

  describe("toAssembledNearest", () => {
    it("is the exact line when it mapped", () => {
      expect(map.toAssembledNearest(3)).toBe(5);
    });

    it("falls back to the nearest mapped line above a placeholder", () => {
      // The placeholder's own line (5) and the blank above it (4) both land
      // on the intro paragraph: still inside the section, which is the point.
      expect(map.toAssembledNearest(5)).toBe(5);
      expect(map.toAssembledNearest(4)).toBe(5);
    });

    it("is undefined when nothing at or above the line mapped", () => {
      const none = buildPreviewLineMap("\\section{S}\nText.", ASSEMBLED);
      expect(none.size).toBe(0);
      expect(none.toAssembledNearest(2)).toBeUndefined();
    });
  });
});
