import { describe, it, expect } from "vitest";
import { createBrailleTranslator } from "../prefigureBraille";
import { brailleAsciiToUnicode } from "../generators/prefigure/braille/liblouis";

describe("PreFigure's braille translator", () => {
  it("writes text in contracted UEB, as Unicode braille", async () => {
    const braille = await createBrailleTranslator();
    // "the" is one cell in grade 2; a capital takes an indicator.
    expect(braille.text("the")).toBe("⠮");
    expect(braille.text("Graph")).toBe("⠠⠛⠗⠁⠏⠓");
  });

  it("has room for output longer than its input", async () => {
    const braille = await createBrailleTranslator();
    const text = "ABC 123 XYZ 456 ".repeat(20).trim();
    const out = braille.text(text);
    expect(out.length).toBeGreaterThan(text.length);
    expect(out).toMatch(/^[⠀-⣿ ]+$/);
  });

  it("writes math in Nemeth", async () => {
    const braille = await createBrailleTranslator();
    expect(braille.math("<math><msup><mi>x</mi><mn>2</mn></msup></math>")).toBe("⠭⠘⠆");
  });

  it("maps braille ASCII to cells, either case", () => {
    expect(brailleAsciiToUnicode("ab ,")).toBe("⠁⠃⠀⠠");
    expect(brailleAsciiToUnicode("AB")).toBe("⠁⠃");
  });
});
