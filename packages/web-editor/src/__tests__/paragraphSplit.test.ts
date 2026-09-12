/**
 * Shift+Enter's paragraph split. What is under test is the decision — whether
 * the cursor's position allows a real split of the `<p>`'s text, or has to
 * degrade to appending an empty sibling instead — and the exact reconstructed
 * text, including matching indentation.
 */
import { describe, it, expect } from "vitest";
import { planParagraphSplit } from "../components/editorConfigs/paragraphSplit";

/** Cursor position marked in the source with `|`, which is then removed. */
const at = (marked: string): [string, number] => {
  const offset = marked.indexOf("|");
  return [marked.replace("|", ""), offset];
};

const plan = (marked: string) => {
  const [source, offset] = at(marked);
  return planParagraphSplit(source, offset);
};

describe("planParagraphSplit", () => {
  it("returns null when the cursor isn't inside a <p>", () => {
    expect(plan("|<section><p>prose</p></section>")).toBeNull();
    expect(plan("<p>one</p>|<p>two</p>")).toBeNull();
    expect(plan("<section><title>Hi|</title></section>")).toBeNull();
  });

  it("splits at the cursor when it's directly in the paragraph's text", () => {
    const result = plan("<p>The car is fa|st.</p>");
    expect(result).toEqual({
      range: { start: 0, end: "<p>The car is fast.</p>".length },
      text: "<p>The car is fa</p>\n<p>st.</p>",
      cursorOffset: "<p>The car is fa</p>\n<p>".length,
    });
  });

  it("splits at the very start of the paragraph, leaving an empty first half", () => {
    const result = plan("<p>|prose</p>");
    expect(result).toEqual({
      range: { start: 0, end: "<p>prose</p>".length },
      text: "<p></p>\n<p>prose</p>",
      cursorOffset: "<p></p>\n<p>".length,
    });
  });

  it("splits at the very end of the paragraph, leaving an empty second half", () => {
    const result = plan("<p>prose|</p>");
    expect(result).toEqual({
      range: { start: 0, end: "<p>prose</p>".length },
      text: "<p>prose</p>\n<p></p>",
      cursorOffset: "<p>prose</p>\n<p>".length,
    });
  });

  it("splits an unterminated paragraph running to the end of the source, leaving it unterminated", () => {
    const result = plan("<p>The car is fa|st.");
    expect(result).toEqual({
      range: { start: 0, end: "<p>The car is fast.".length },
      text: "<p>The car is fa</p>\n<p>st.",
      cursorOffset: "<p>The car is fa</p>\n<p>".length,
    });
  });

  it("reuses the original tag's indentation for the new line", () => {
    const marked = "<section>\n  <p>The car is fa|st.</p>\n</section>";
    const tagStart = "<section>\n  ".length;
    const result = plan(marked);
    expect(result).toEqual({
      range: { start: tagStart, end: tagStart + "<p>The car is fast.</p>".length },
      text: "<p>The car is fa</p>\n  <p>st.</p>",
      cursorOffset: tagStart + "<p>The car is fa</p>\n  <p>".length,
    });
  });

  it("doesn't invent indentation when the <p> isn't alone on its line", () => {
    const result = plan("<statement><p>The car is fa|st.</p></statement>");
    expect(result?.text).toBe("<p>The car is fa</p>\n<p>st.</p>");
  });

  it("does not copy the original tag's attributes onto the new tag", () => {
    const result = plan('<p xml:id="p1">The car is fa|st.</p>');
    expect(result?.text).toBe('<p xml:id="p1">The car is fa</p>\n<p>st.</p>');
  });

  it("falls back to an empty sibling when the cursor is nested inside inline markup", () => {
    const source = "<p>Some <em>emphasized text</em> here.</p>";
    const marked = "<p>Some <em>emphasized te|xt</em> here.</p>";
    expect(plan(marked)).toEqual({
      range: { start: source.length, end: source.length },
      text: "\n<p></p>",
      cursorOffset: source.length + "\n<p>".length,
    });
  });

  it("falls back at the very edges of the nested element too", () => {
    // Just after <em>'s opening tag, and just before its closing tag — both
    // are still inside it, per `isDirectParagraphText`'s tag-walk.
    const source = "<p>Some <em>text</em> here.</p>";
    expect(plan("<p>Some <em>|text</em> here.</p>")).toEqual({
      range: { start: source.length, end: source.length },
      text: "\n<p></p>",
      cursorOffset: source.length + "\n<p>".length,
    });
    expect(plan("<p>Some <em>text|</em> here.</p>")).toEqual({
      range: { start: source.length, end: source.length },
      text: "\n<p></p>",
      cursorOffset: source.length + "\n<p>".length,
    });
  });

  it("splits cleanly right after a self-closing inline element", () => {
    const result = plan("<p>See <cline/>|here.</p>");
    expect(result).toEqual({
      range: { start: 0, end: "<p>See <cline/>here.</p>".length },
      text: "<p>See <cline/></p>\n<p>here.</p>",
      cursorOffset: "<p>See <cline/></p>\n<p>".length,
    });
  });

  it("indents the fallback's new sibling to match the original tag's line", () => {
    const marked = "<section>\n  <p>Some <em>emphasized te|xt</em> here.</p>\n</section>";
    const paragraphEnd = "<section>\n  <p>Some <em>emphasized text</em> here.</p>".length;
    expect(plan(marked)).toEqual({
      range: { start: paragraphEnd, end: paragraphEnd },
      text: "\n  <p></p>",
      cursorOffset: paragraphEnd + "\n  <p>".length,
    });
  });

  it("appends the empty sibling after the whole paragraph, not just past the element", () => {
    const marked = "<p>Some <em>te|xt</em> here.</p><p>next</p>";
    const paragraphEnd = "<p>Some <em>text</em> here.</p>".length;
    expect(plan(marked)).toEqual({
      range: { start: paragraphEnd, end: paragraphEnd },
      text: "\n<p></p>",
      cursorOffset: paragraphEnd + "\n<p>".length,
    });
  });
});
