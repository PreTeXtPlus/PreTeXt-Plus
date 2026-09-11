/**
 * Shift+Enter's paragraph split. What is under test is the decision —
 * whether the cursor's position allows a real split of the `<p>`'s text, or
 * has to degrade to appending an empty sibling instead.
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
    expect(plan("<p>The car is fa|st.</p>")).toEqual({
      offset: "<p>The car is fa".length,
      body: "</p>\n<p>$0",
    });
  });

  it("splits at the very start of the paragraph, leaving an empty first half", () => {
    expect(plan("<p>|prose</p>")).toEqual({
      offset: "<p>".length,
      body: "</p>\n<p>$0",
    });
  });

  it("splits at the very end of the paragraph, leaving an empty second half", () => {
    expect(plan("<p>prose|</p>")).toEqual({
      offset: "<p>prose".length,
      body: "</p>\n<p>$0",
    });
  });

  it("splits an unterminated paragraph running to the end of the source", () => {
    expect(plan("<p>The car is fa|st.")).toEqual({
      offset: "<p>The car is fa".length,
      body: "</p>\n<p>$0",
    });
  });

  it("falls back to an empty sibling when the cursor is nested inside inline markup", () => {
    const source = "<p>Some <em>emphasized text</em> here.</p>";
    const marked = "<p>Some <em>emphasized te|xt</em> here.</p>";
    expect(plan(marked)).toEqual({
      offset: source.length,
      body: "\n<p>$0</p>",
    });
  });

  it("falls back at the very edges of the nested element too", () => {
    // Just after <em>'s opening tag, and just before its closing tag — both
    // are still inside it, per `isDirectParagraphText`'s tag-walk.
    expect(plan("<p>Some <em>|text</em> here.</p>")).toEqual({
      offset: "<p>Some <em>text</em> here.</p>".length,
      body: "\n<p>$0</p>",
    });
    expect(plan("<p>Some <em>text|</em> here.</p>")).toEqual({
      offset: "<p>Some <em>text</em> here.</p>".length,
      body: "\n<p>$0</p>",
    });
  });

  it("splits cleanly right after a self-closing inline element", () => {
    expect(plan("<p>See <cline/>|here.</p>")).toEqual({
      offset: "<p>See <cline/>".length,
      body: "</p>\n<p>$0",
    });
  });

  it("does not copy the original tag's attributes onto the new one", () => {
    const result = plan('<p xml:id="p1">The car is fa|st.</p>');
    expect(result?.body).toBe("</p>\n<p>$0");
  });

  it("appends the empty sibling after the whole paragraph, not just past the element", () => {
    const marked = "<p>Some <em>te|xt</em> here.</p><p>next</p>";
    expect(plan(marked)).toEqual({
      offset: "<p>Some <em>text</em> here.</p>".length,
      body: "\n<p>$0</p>",
    });
  });
});
