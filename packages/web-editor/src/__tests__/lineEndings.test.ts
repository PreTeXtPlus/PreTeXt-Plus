import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { normalizeLineEndings } from "../lineEndings";
import { diffReplace, stripCarriageReturns } from "../collab/textDiff";
import { makeDivisionEntry, makeText, getEntryText } from "../collab/schema";
import { convertImportText } from "../importConvert";
import { convertPastedSnippet } from "../pasteConvert";

/** A `Y.Text` attached to a doc (a detached one cannot be read). */
const textIn = (doc: Y.Doc, content: string): Y.Text => {
  const text = doc.getText("t");
  text.insert(0, content);
  return text;
};

describe("normalizeLineEndings", () => {
  it("writes CRLF and a lone CR as LF, and leaves LF text alone", () => {
    expect(normalizeLineEndings("a\r\nb\rc\n\r\nd")).toBe("a\nb\nc\n\nd");
    expect(normalizeLineEndings("a\nb")).toBe("a\nb");
  });
});

describe("stripCarriageReturns", () => {
  it("removes the CR of every CRLF and reports it", () => {
    const text = textIn(new Y.Doc(), "\r\na\r\n\r\nb\r\n");
    expect(text.doc!.transact(() => stripCarriageReturns(text))).toBe(true);
    expect(text.toString()).toBe("\na\n\nb\n");
    expect(text.doc!.transact(() => stripCarriageReturns(text))).toBe(false);
  });

  it("converges when two peers strip the same text at once", () => {
    const a = new Y.Doc();
    const textA = textIn(a, "one\r\ntwo\r\nthree");
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const textB = b.getText("t");

    a.transact(() => stripCarriageReturns(textA));
    b.transact(() => stripCarriageReturns(textB));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(textA.toString()).toBe("one\ntwo\nthree");
    expect(textB.toString()).toBe("one\ntwo\nthree");
  });
});

describe("shared text is written with LF", () => {
  it("in a seeded entry", () => {
    const doc = new Y.Doc();
    doc.getMap("divisions").set(
      "id",
      makeDivisionEntry({ xmlId: "s", sourceFormat: "latex", source: "a\r\nb" }),
    );
    doc.getMap("x").set("t", makeText("c\r\nd"));
    expect(getEntryText(doc.getMap<Y.Map<unknown>>("divisions").get("id"))?.toString()).toBe("a\nb");
    expect((doc.getMap("x").get("t") as Y.Text).toString()).toBe("c\nd");
  });

  it("in a whole-string rewrite", () => {
    const text = textIn(new Y.Doc(), "a\nb");
    text.doc!.transact(() => diffReplace(text, "a\r\nb\r\nc"));
    expect(text.toString()).toBe("a\nb\nc");
  });
});

describe("text converted on its way in", () => {
  const lf = "First line\nsecond line.\n\nNext paragraph.";
  const crlf = lf.replace(/\n/g, "\r\n");

  it("imports CRLF LaTeX as it does LF", () => {
    const fromLf = convertImportText(lf, "latex", { clean: false });
    expect(fromLf.pretext.match(/<p>/g)).toHaveLength(2);
    expect(convertImportText(crlf, "latex", { clean: false })).toEqual(fromLf);
  });

  it("converts a CRLF LaTeX paste as it does an LF one", () => {
    const model = { getValueInRange: () => "", getLineContent: () => "" };
    const position = { lineNumber: 1, column: 1 };
    const snippet = "\\begin{theorem}\nFirst line\nsecond line.\n\\end{theorem}";
    const fromLf = convertPastedSnippet(snippet, model, position);
    expect(fromLf).toBeDefined();
    expect(convertPastedSnippet(snippet.replace(/\n/g, "\r\n"), model, position)).toEqual(fromLf);
  });
});
