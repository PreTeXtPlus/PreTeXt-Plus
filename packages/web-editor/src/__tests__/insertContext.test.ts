/**
 * The Insert menu's placement gate. What is under test is the reading of the
 * buffer — where a `<p>` starts and stops being the cursor's parent — and the
 * four decisions that follow from it. The schema's opinion of the resulting
 * markup is `snippets.test.ts`'s job.
 */
import { describe, it, expect } from "vitest";
import {
  enclosingParagraph,
  planSnippetInsertion,
} from "../components/editorConfigs/insertContext";
import {
  snippetGroupsFor,
  type EditorSnippet,
} from "../components/editorConfigs/snippets";
import type { SourceFormat } from "../types/editor";

/** Cursor position marked in the source with `|`, which is then removed. */
const at = (marked: string): [string, number] => {
  const offset = marked.indexOf("|");
  return [marked.replace("|", ""), offset];
};

const paragraphAt = (marked: string) => {
  const [source, offset] = at(marked);
  return enclosingParagraph(source, offset);
};

const snippetOf = (format: SourceFormat, key: string): EditorSnippet => {
  const snippet = snippetGroupsFor(format)
    .flatMap((group) => group.snippets)
    .find((entry) => entry.key === key);
  if (!snippet) throw new Error(`no ${key} snippet for ${format}`);
  return snippet;
};

const plan = (marked: string, key: string, format: SourceFormat = "pretext") => {
  const [source, offset] = at(marked);
  return planSnippetInsertion(source, offset, snippetOf(format, key), format);
};

describe("enclosingParagraph", () => {
  it("finds the paragraph the cursor is inside", () => {
    expect(paragraphAt("<section><p>some pr|ose</p></section>")).toEqual({
      contentStart: "<section><p>".length,
      end: "<section><p>some prose</p>".length,
    });
  });

  it("counts the edges of the paragraph as inside it", () => {
    expect(paragraphAt("<p>|prose</p>")).not.toBeNull();
    expect(paragraphAt("<p>prose|</p>")).not.toBeNull();
  });

  it("counts the space either side of the paragraph as outside it", () => {
    expect(paragraphAt("|<p>prose</p>")).toBeNull();
    expect(paragraphAt("<p>prose</p>|")).toBeNull();
    expect(paragraphAt("<p>one</p>\n|\n<p>two</p>")).toBeNull();
  });

  it("reports the innermost paragraph, not an outer one", () => {
    const source = "<p><ul><li><p>item|</p></li></ul></p>";
    expect(paragraphAt(source)?.contentStart).toBe(
      "<p><ul><li><p>".length,
    );
  });

  it("is not fooled by a paragraph the cursor merely follows", () => {
    expect(paragraphAt("<p>one</p><theorem><statement>|")).toBeNull();
  });

  it("ignores markup inside comments, CDATA and attribute values", () => {
    expect(paragraphAt("<!-- <p> --><section>|</section>")).toBeNull();
    expect(paragraphAt("<program><code><![CDATA[<p>]]></code>|")).toBeNull();
    expect(paragraphAt('<image alt="a > b"/><section>|</section>')).toBeNull();
  });

  it("treats a self-closing paragraph as opening nothing", () => {
    expect(paragraphAt("<p/>|")).toBeNull();
  });

  it("runs an unterminated paragraph to the end of the source", () => {
    const source = "<section><p>half typed|";
    expect(paragraphAt(source)?.end).toBe(source.replace("|", "").length);
  });

  it("survives a stray `<` rather than losing the paragraph", () => {
    expect(paragraphAt("<p>if a < b then|</p>")).not.toBeNull();
  });
});

describe("planSnippetInsertion", () => {
  it("wraps a list in a paragraph when the cursor is between paragraphs", () => {
    const { offset, body } = plan("<p>one</p>\n|\n<p>two</p>", "list-bulleted");

    expect(offset).toBe("<p>one</p>\n".length);
    expect(body).toBe(
      ["<p>", "\t<ul>", "\t\t<li>", "\t\t\t<p>$0</p>", "\t\t</li>", "\t</ul>", "</p>"].join(
        "\n",
      ),
    );
  });

  it("leaves the wrapper off when the cursor is already in a paragraph", () => {
    const { body } = plan("<p>prose |</p>", "list-bulleted");

    expect(body).toBe(snippetOf("pretext", "list-bulleted").body);
    expect(body.startsWith("<p>")).toBe(false);
  });

  it("keeps an inline construct on one line when it wraps it", () => {
    expect(plan("<section>\n|\n</section>", "emphasis").body).toBe(
      "<p><em>$0</em></p>",
    );
    expect(plan("<p>prose |</p>", "emphasis").body).toBe("<em>$0</em>");
  });

  it("moves a block construct past the paragraph it cannot nest in", () => {
    const source = "<section>\n<p>pro|se</p>\n</section>";
    const { offset, body } = plan(source, "theorem");

    expect(source.replace("|", "").slice(0, offset)).toBe(
      "<section>\n<p>prose</p>",
    );
    // On a line of its own, rather than trailing the `</p>`.
    expect(body).toBe(`\n${snippetOf("pretext", "theorem").body}`);
  });

  it("leaves a block construct where it is when no paragraph is in the way", () => {
    const source = "<section>\n|\n</section>";
    const { offset, body } = plan(source, "theorem");

    expect(offset).toBe("<section>\n".length);
    expect(body).toBe(snippetOf("pretext", "theorem").body);
  });

  it("inserts a paragraph beside the one being edited, never inside it", () => {
    expect(plan("<p>pro|se</p>", "paragraph").offset).toBe(
      "<p>prose</p>".length,
    );
  });

  it("leaves LaTeX and Markdown bodies exactly as written", () => {
    // A `<p>` in either buffer would be literal text, not the structure the
    // gate reads it as — so those formats are never gated at all.
    for (const format of ["latex", "markdown"] as const) {
      const list = snippetOf(format, "list-bulleted");
      const result = planSnippetInsertion("<p>prose</p>", 3, list, format);

      expect(result).toEqual({ offset: 3, body: list.body });
    }
  });
});
