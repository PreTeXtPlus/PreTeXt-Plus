import { describe, it, expect } from "vitest";
import {
  computeLockedRegion,
  findPretextHeaderEnd,
  isRangeWithin,
  type LockedRegionModel,
} from "../components/lockedRegion";

/** A stand-in for Monaco's text model, backed by a plain string. */
const model = (source: string): LockedRegionModel => {
  const lines = source.split("\n");
  return {
    getLineCount: () => lines.length,
    getLineContent: (n) => lines[n - 1] ?? "",
    getLineMaxColumn: (n) => (lines[n - 1]?.length ?? 0) + 1,
  };
};

/** Monaco-style range from `[startLine, startCol, endLine, endCol]`. */
const range = (
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
) => ({ startLineNumber, startColumn, endLineNumber, endColumn });

describe("findPretextHeaderEnd", () => {
  it("covers the opening tag alone when no title follows it", () => {
    expect(
      findPretextHeaderEnd(
        model(`<introduction xml:id="i">\n  <p>Hi.</p>\n</introduction>`),
      ),
    ).toBe(1);
  });

  it("extends through a single-line title", () => {
    expect(
      findPretextHeaderEnd(
        model(`<section xml:id="s">\n  <title>T</title>\n  <p/>\n</section>`),
      ),
    ).toBe(2);
  });

  it("extends through a title spanning several lines", () => {
    expect(
      findPretextHeaderEnd(
        model(
          `<section xml:id="s">\n  <title>A long\n  wrapped\n  title</title>\n  <p/>\n</section>`,
        ),
      ),
    ).toBe(4);
  });

  it("falls back to the opening tag when the title is never closed", () => {
    expect(
      findPretextHeaderEnd(model(`<section xml:id="s">\n  <title>oops\n  <p/>`)),
    ).toBe(1);
  });
});

describe("computeLockedRegion — pretext", () => {
  it("locks the header and the closing tag, leaving the body editable", () => {
    const region = computeLockedRegion(
      model(
        `<section xml:id="s">\n  <title>T</title>\n  <p>Body.</p>\n</section>`,
      ),
      "pretext",
    );
    expect(region).not.toBeNull();
    expect(region!.lockedLines).toEqual([1, 2, 4]);
    expect(region!.leadingLockedLines).toBe(2);
    // `  <p>Body.</p>` is 14 characters, so its last column is 15.
    expect(region!.editableRange).toEqual([3, 1, 3, 15]);
  });

  it("locks nothing once the body has collapsed away", () => {
    // The state `ensurePretextBodyLine` exists to repair: with no line between
    // the wrapper tags there is nowhere unlocked to type, so the guard stands
    // down rather than trapping the user.
    expect(
      computeLockedRegion(
        model(`<section xml:id="s">\n  <title>T</title>\n</section>`),
        "pretext",
      ),
    ).toBeNull();
  });

  it("tracks the closing tag as the body grows", () => {
    const region = computeLockedRegion(
      model(
        `<section xml:id="s">\n  <title>T</title>\n  <p>One.</p>\n  <p>Two.</p>\n</section>`,
      ),
      "pretext",
    );
    expect(region!.lockedLines).toEqual([1, 2, 5]);
    expect(region!.editableRange[2]).toBe(4);
  });
});

describe("computeLockedRegion — markdown and latex", () => {
  it("locks a markdown frontmatter block", () => {
    const region = computeLockedRegion(
      model(`---\ntype: section\nxml:id: s\n---\nBody text.`),
      "markdown",
    );
    expect(region!.lockedLines).toEqual([1, 2, 3, 4]);
    expect(region!.leadingLockedLines).toBe(4);
    expect(region!.editableRange).toEqual([5, 1, 5, 11]);
  });

  it("locks nothing when markdown frontmatter is unterminated", () => {
    expect(
      computeLockedRegion(model(`---\ntype: section\nBody.`), "markdown"),
    ).toBeNull();
  });

  it("locks a latex division header line and the blank line below it", () => {
    const region = computeLockedRegion(
      model(`\\section{Title}\\label{s}\n\nBody text.`),
      "latex",
    );
    expect(region!.lockedLines).toEqual([1, 2]);
    expect(region!.leadingLockedLines).toBe(2);
    expect(region!.editableRange).toEqual([3, 1, 3, 11]);
  });

  it("locks the latex header alone until the blank line is inserted", () => {
    // `CodeEditor.ensureLatexHeaderBlankLine` repairs this on the next pass;
    // until it does, the author's first paragraph must not be frozen.
    const region = computeLockedRegion(
      model(`\\section{Title}\\label{s}\nBody text.`),
      "latex",
    );
    expect(region!.lockedLines).toEqual([1]);
    expect(region!.leadingLockedLines).toBe(1);
    expect(region!.editableRange).toEqual([2, 1, 2, 11]);
  });

  it("locks nothing when a latex division is only a header and a blank line", () => {
    // Locking both would leave no editable line at all.
    expect(
      computeLockedRegion(model(`\\section{Title}\\label{s}\n`), "latex"),
    ).toBeNull();
  });

  it("locks nothing for an environment-style latex division", () => {
    expect(
      computeLockedRegion(
        model(`\\begin{section}\nBody.\n\\end{section}`),
        "latex",
      ),
    ).toBeNull();
  });

  it("locks nothing when a latex body merely opens with a macro", () => {
    // `\emph` names no division, so this is the first line of an
    // introduction's prose — not a header to freeze.
    expect(
      computeLockedRegion(
        model(`\\emph{Once} upon a time.\n\nMore prose.`),
        "latex",
      ),
    ).toBeNull();
  });
});

describe("isRangeWithin", () => {
  // The single body line of
  // `<section xml:id="s">\n  <title>T</title>\n  <p>Body.</p>\n</section>`.
  const editable: [number, number, number, number] = [3, 1, 3, 15];

  it("accepts an edit inside the body", () => {
    expect(isRangeWithin(editable, range(3, 3, 3, 7))).toBe(true);
  });

  it("accepts a zero-width insertion at either boundary", () => {
    expect(isRangeWithin(editable, range(3, 1, 3, 1))).toBe(true);
    expect(isRangeWithin(editable, range(3, 15, 3, 15))).toBe(true);
  });

  it("rejects a backspace that would merge the body into the header", () => {
    // Deleting at column 1 of the first body line spans back onto the header.
    expect(isRangeWithin(editable, range(2, 19, 3, 1))).toBe(false);
  });

  it("rejects an edit that reaches the closing tag", () => {
    expect(isRangeWithin(editable, range(3, 5, 4, 1))).toBe(false);
  });

  it("rejects a select-all overwrite", () => {
    expect(isRangeWithin(editable, range(1, 1, 4, 11))).toBe(false);
  });

  it("rejects a caret parked on a locked line", () => {
    expect(isRangeWithin(editable, range(1, 4, 1, 4))).toBe(false);
  });
});
