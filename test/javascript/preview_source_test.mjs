import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assemblePreviewSource } from "../../app/javascript/controllers/preview_source.js";

const DOCINFO = "<docinfo><macros>\\newcommand{\\N}{\\mathbb{N}}</macros></docinfo>";
const PRETEXT_FRAGMENT = "<section><title>Hello</title><p>World</p></section>";
const LATEX_RAW = "\\section{Hello}\n\nWorld";

describe("assemblePreviewSource", () => {
  describe("pretext format", () => {
    it("returns content as-is when no docinfo", () => {
      const result = assemblePreviewSource({
        content: PRETEXT_FRAGMENT,
        sourceFormat: "pretext",
        pretextSource: "",
        docinfo: "",
      });
      assert.equal(result, PRETEXT_FRAGMENT);
    });

    it("wraps content in full pretext document when docinfo is present", () => {
      const result = assemblePreviewSource({
        content: PRETEXT_FRAGMENT,
        sourceFormat: "pretext",
        pretextSource: "",
        docinfo: DOCINFO,
      });
      assert.match(result, /^<pretext>/);
      assert.match(result, /<\/pretext>$/);
      assert.ok(result.includes(DOCINFO), "should include docinfo block");
      assert.ok(result.includes('<article label="article">'), "should include article wrapper");
      assert.ok(result.includes(PRETEXT_FRAGMENT), "should include content");
    });
  });

  describe("latex format", () => {
    it("uses pretextSource instead of raw latex content when pretextSource is present", () => {
      const result = assemblePreviewSource({
        content: LATEX_RAW,
        sourceFormat: "latex",
        pretextSource: PRETEXT_FRAGMENT,
        docinfo: "",
      });
      assert.equal(result, PRETEXT_FRAGMENT);
      assert.ok(!result.includes(LATEX_RAW), "should not include raw latex");
    });

    it("falls back to raw content when pretextSource is absent", () => {
      const result = assemblePreviewSource({
        content: LATEX_RAW,
        sourceFormat: "latex",
        pretextSource: "",
        docinfo: "",
      });
      assert.equal(result, LATEX_RAW);
    });

    it("falls back to raw content when pretextSource is undefined", () => {
      const result = assemblePreviewSource({
        content: LATEX_RAW,
        sourceFormat: "latex",
        pretextSource: undefined,
        docinfo: "",
      });
      assert.equal(result, LATEX_RAW);
    });

    it("wraps pretextSource in full document when docinfo is present", () => {
      const result = assemblePreviewSource({
        content: LATEX_RAW,
        sourceFormat: "latex",
        pretextSource: PRETEXT_FRAGMENT,
        docinfo: DOCINFO,
      });
      assert.match(result, /^<pretext>/);
      assert.match(result, /<\/pretext>$/);
      assert.ok(result.includes(DOCINFO), "should include docinfo block");
      assert.ok(result.includes('<article label="article">'), "should include article wrapper");
      assert.ok(result.includes(PRETEXT_FRAGMENT), "should include converted pretext body");
      assert.ok(!result.includes(LATEX_RAW), "should not include raw latex");
    });

    it("wraps fallback content in full document when docinfo is present but pretextSource is absent", () => {
      const result = assemblePreviewSource({
        content: LATEX_RAW,
        sourceFormat: "latex",
        pretextSource: "",
        docinfo: DOCINFO,
      });
      assert.match(result, /^<pretext>/);
      assert.ok(result.includes(DOCINFO));
      assert.ok(result.includes(LATEX_RAW), "should include raw latex as fallback body");
    });
  });

  describe("other formats (pmd)", () => {
    it("returns content as-is when no docinfo", () => {
      const result = assemblePreviewSource({
        content: "# Hello\n\nWorld",
        sourceFormat: "pmd",
        pretextSource: "",
        docinfo: "",
      });
      assert.equal(result, "# Hello\n\nWorld");
    });
  });
});
