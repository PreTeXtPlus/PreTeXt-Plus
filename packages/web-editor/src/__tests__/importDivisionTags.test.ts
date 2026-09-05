/**
 * The contract between `@pretextbook/import` and this editor.
 *
 * An import splits a document at every tag in its `PRETEXT_DIVISION_TAGS`,
 * emitting a `<plus:TAG ref="…"/>` placeholder in the parent for each division
 * it lifts out. If this editor cannot parse one of those placeholders, the
 * division record still arrives — it is just orphaned, with nothing pointing
 * at its position, and the TOC shows it adrift.
 *
 * So the importer's list must stay a subset of what `parseDivisionRefs`
 * accepts. This test reads the list from the package itself rather than
 * restating it, which is the point: when upstream adds a tag (see
 * PreTeXtBook/pretext-tools#257, which adds `handout`, `introduction`, and
 * `conclusion`), a `npm update` either keeps this green or tells us exactly
 * which tag we still owe a `DivisionType`.
 *
 * `@pretextbook/import` is a devDependency here for this file alone — the
 * library never imports it at runtime; only the host app runs the wizard.
 */

import { describe, it, expect } from "vitest";
import { PRETEXT_DIVISION_TAGS, PRETEXT_ROOT_TAGS } from "@pretextbook/import";
import {
  parseDivisionRefs,
  parseDivisionRefsWithTypes,
} from "../sectionUtils";
import {
  ALLOWED_CHILD_DIVISION_TYPES,
  DIVISION_ID_PREFIXES,
  TYPE_FULL_LABELS,
} from "../components/toc/types";
import type { DivisionType } from "../types/sections";

/** A parent whose body is a single placeholder for a division of `tag`. */
const parentWithPlaceholder = (tag: string) =>
  `<article xml:id="art">\n  <title>Doc</title>\n  <plus:${tag} ref="ref-x"/>\n</article>`;

describe("importer division tags", () => {
  it("are all parsed as division refs", () => {
    const unparsed = PRETEXT_DIVISION_TAGS.filter(
      (tag) => parseDivisionRefs(parentWithPlaceholder(tag), "pretext").length === 0,
    );

    expect(unparsed).toEqual([]);
  });

  it("keep their own type rather than collapsing to section", () => {
    const mistyped = PRETEXT_DIVISION_TAGS.map((tag) => ({
      tag,
      parsed: parseDivisionRefsWithTypes(parentWithPlaceholder(tag), "pretext")[0],
    }))
      .filter(({ tag, parsed }) => parsed?.type !== tag)
      .map(({ tag, parsed }) => `${tag} → ${parsed?.type ?? "(unparsed)"}`);

    expect(mistyped).toEqual([]);
  });

  it("each have a nesting rule, an id prefix, and a label", () => {
    const missing: string[] = [];
    for (const tag of [...PRETEXT_DIVISION_TAGS, ...PRETEXT_ROOT_TAGS]) {
      const type = tag as DivisionType;
      if (!(type in ALLOWED_CHILD_DIVISION_TYPES)) missing.push(`${tag}: nesting rule`);
      if (!DIVISION_ID_PREFIXES[type]) missing.push(`${tag}: id prefix`);
      if (!TYPE_FULL_LABELS[tag]) missing.push(`${tag}: label`);
    }

    expect(missing).toEqual([]);
  });

  it("round-trips a placeholder for every tag through parse", () => {
    // One parent holding a placeholder for each tag at once — the real shape of
    // an imported root, and a check that the alternation doesn't mis-split on
    // hyphenated tags like `reading-questions`.
    const body = PRETEXT_DIVISION_TAGS.map(
      (tag, i) => `  <plus:${tag} ref="ref-${i}"/>`,
    ).join("\n");
    const refs = parseDivisionRefs(
      `<article xml:id="art">\n  <title>Doc</title>\n${body}\n</article>`,
      "pretext",
    );

    expect(refs).toEqual(PRETEXT_DIVISION_TAGS.map((_, i) => `ref-${i}`));
  });
});
