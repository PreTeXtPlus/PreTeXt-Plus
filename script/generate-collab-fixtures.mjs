// Generates the Yjs byte fixtures under test/fixtures/files/collab/.
//
// The Ruby side of collaborative editing can read a document but not write one:
// yrby's bindings expose read_map/read_text and apply_update, and nothing that
// creates content. So the updates the Ruby tests feed to ProjectDocChannel have
// to be produced by a Yjs that can write them -- and produced through the
// editor's own schema, so a test asserting on what the server stored is
// asserting about the real document shape rather than a hand-rolled one.
//
//   node script/generate-collab-fixtures.mjs
//
// Re-run and commit the result if the collab schema changes.
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { seedDocFromState, markDeleted } from "../packages/web-editor/src/collab/schema.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../test/fixtures/files/collab/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ROOT_ID = "11111111-1111-4111-8111-111111111111";

// A minimal project document in the editor's schema.
const doc = new Y.Doc();
seedDocFromState(doc, {
  title: "Fixture Project",
  docinfo: "<docinfo/>",
  divisions: [
    {
      id: ROOT_ID,
      xmlId: "root",
      sourceFormat: "pretext",
      type: "book",
      title: "Fixture Book",
      source: "<p>Fixture Book</p>",
    },
  ],
});
writeFileSync(OUT + "seed_state.bin", Y.encodeStateAsUpdate(doc));

// One incremental update on top of that seed -- the shape of a keystroke.
const before = Y.encodeStateVector(doc);
doc.getMap("divisions").get(ROOT_ID).get("source").insert(2, ' xmlns:plus="https://pretext.plus"');
writeFileSync(OUT + "one_update.bin", Y.encodeStateAsUpdate(doc, before));

// A second, independent seed: the content that would be duplicated if the
// server ever accepted two seeds for one project.
const rival = new Y.Doc();
seedDocFromState(rival, {
  title: "Rival Project",
  docinfo: "<docinfo/>",
  divisions: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      xmlId: "rival",
      sourceFormat: "pretext",
      type: "book",
      title: "Rival Book",
      source: "<p>Rival</p>",
    },
  ],
});
writeFileSync(OUT + "rival_state.bin", Y.encodeStateAsUpdate(rival));

// A real awareness frame, framed exactly as yrby-client frames one: the
// y-protocols message type as a varint, then the length-prefixed awareness
// update. The server validates the payload rather than trusting the tag, so an
// arbitrary byte string will not do.
const awareness = new Awareness(doc);
awareness.setLocalStateField("user", { name: "Fixture User", color: "#abcdef" });
const encoder = encoding.createEncoder();
encoding.writeVarUint(encoder, 1); // MessageType.Awareness
encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [doc.clientID]));
writeFileSync(OUT + "awareness_frame.bin", encoding.toUint8Array(encoder));
awareness.destroy();

// A document with everything ProjectDocProjection reads: every meta field, two
// divisions in different source formats -- their bodies, and the fields their
// elements are built from -- and tombstones for a division and an asset removed
// during the session.
const projected = new Y.Doc();
seedDocFromState(projected, {
  title: "Projected Title",
  docinfo: "<docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros></docinfo>",
  useCommonDocinfo: false,
  language: "fr-FR",
  divisions: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      xmlId: "projected-root",
      sourceFormat: "pretext",
      type: "book",
      title: "Projected Book",
      source: "<p>The projected book.</p>",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      xmlId: "projected-ch1",
      sourceFormat: "latex",
      type: "chapter",
      title: "Chapter One",
      attrs: { component: "teacher" },
      source: "The first chapter.",
    },
  ],
});
markDeleted(projected, "division", "55555555-5555-4555-8555-555555555555");
markDeleted(projected, "asset", "66666666-6666-4666-8666-666666666666");
writeFileSync(OUT + "projection_state.bin", Y.encodeStateAsUpdate(projected));

// Snippets, exercises and assets as ProjectDocProjection reads them: each
// record's source is shared text (a nested Y.Text), like a division's. One
// asset the project knows, one it doesn't (an asset row is created by its
// upload, never by a projection), and a snippet and an exercise removed during
// the session.
const records = new Y.Doc();
seedDocFromState(records, {
  title: "Records",
  docinfo: "<docinfo/>",
  divisions: [],
  snippets: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      ref: "projected-note",
      title: "A Projected Note",
      sourceFormat: "latex",
      source: "A \\emph{projected} note.",
    },
  ],
  exercises: [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ref: "projected-quiz",
      title: "A Projected Quiz",
      attrs: { language: "python" },
      source: "<statement><p>Order the lines.</p></statement>",
    },
    // A Doenet activity: DoenetML in `source`, the <interactive>'s attributes in `attrs`.
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ref: "projected-drag",
      title: "A Projected Activity",
      sourceFormat: "doenetml",
      attrs: { width: "100%", aspect: "4:3" },
      source: "<p>What is <m>2+2</m>? <answer>4</answer></p>",
    },
  ],
  assets: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      ref: "projected-plot",
      title: "Projected Plot",
      shortDescription: "A plot of the projection",
      source: "<latex-image>p</latex-image>",
    },
    {
      id: "99999999-9999-4999-8999-999999999999",
      ref: "unknown-plot",
      title: "Unknown Plot",
      source: "<latex-image>u</latex-image>",
    },
  ],
});
markDeleted(records, "snippet", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
markDeleted(records, "exercise", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
writeFileSync(OUT + "projection_records_state.bin", Y.encodeStateAsUpdate(records));

// The shapes that have stalled a production projection, together in one
// document, beside a healthy division that must still reach its row:
//
// * an asset entry emptied to `{source: ""}` (every metadata key deleted),
// * a division whose xml:id holds spaces,
// * two new divisions that want the same ref (both collaborators pressed
//   "add section" before either saw the other's),
// * a new division wanting the ref of a row the project already has
//   (`kept`; the test creates that row), and
// * a division wanting the ref the emptied asset's row still holds
//   (`stale-plot`; the test creates that row too).
//
// ProjectDocProjection must skip each bad entry on its own and write the rest.
const issues = new Y.Doc();
seedDocFromState(issues, {
  title: "Issues",
  docinfo: "<docinfo/>",
  divisions: [
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd0",
      xmlId: "healthy-section",
      sourceFormat: "pretext",
      type: "section",
      title: "Healthy",
      source: "<p>Still projected.</p>",
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      xmlId: "sec-chapter 1 ",
      sourceFormat: "pretext",
      type: "chapter",
      title: "Spaced",
      source: "",
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      xmlId: "twins",
      sourceFormat: "pretext",
      type: "section",
      title: "Twin (lower id)",
      source: "<p>lower</p>",
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
      xmlId: "twins",
      sourceFormat: "pretext",
      type: "section",
      title: "Twin (higher id)",
      source: "<p>higher</p>",
    },
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0",
      xmlId: "kept",
      sourceFormat: "pretext",
      type: "section",
      title: "Keeper",
      source: "<p>keeper</p>",
    },
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      xmlId: "kept",
      sourceFormat: "pretext",
      type: "section",
      title: "Newcomer",
      source: "<p>newcomer</p>",
    },
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      xmlId: "stale-plot",
      sourceFormat: "pretext",
      type: "section",
      title: "Wants the asset's ref",
      source: "",
    },
  ],
  assets: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      ref: "projected-plot",
      title: "Projected Plot",
      shortDescription: "A plot of the projection",
      source: "",
    },
  ],
});
{
  // What a client that handed applyAssetFields an all-undefined asset left
  // behind on Nov 4: the Y.Text source and nothing else.
  const emptied = issues.getMap("assets").get("88888888-8888-4888-8888-888888888888");
  for (const key of [...emptied.keys()]) if (key !== "source") emptied.delete(key);
}
writeFileSync(OUT + "projection_issues_state.bin", Y.encodeStateAsUpdate(issues));

// Legal edits that a single all-or-nothing save refuses as "ref has already
// been taken", because every record is validated before any is written:
//
// * a division removed and a new one created with its ref (`reborn`; the test
//   creates the removed row),
// * two divisions whose refs are swapped (`swap-a` <-> `swap-b`), and
// * a chain: A takes B's ref while B moves on (`chain-a` -> `chain-b` -> `chain-c`).
const renames = new Y.Doc();
seedDocFromState(renames, {
  title: "Renames",
  docinfo: "<docinfo/>",
  divisions: [
    {
      id: "12121212-1212-4121-8121-121212121212",
      xmlId: "reborn",
      sourceFormat: "pretext",
      type: "section",
      title: "Reborn",
      source: "<p>reborn</p>",
    },
    {
      id: "13131313-1313-4131-8131-131313131313",
      xmlId: "swap-b",
      sourceFormat: "pretext",
      type: "section",
      title: "Was swap-a",
      source: "",
    },
    {
      id: "14141414-1414-4141-8141-141414141414",
      xmlId: "swap-a",
      sourceFormat: "pretext",
      type: "section",
      title: "Was swap-b",
      source: "",
    },
    {
      id: "15151515-1515-4151-8151-151515151515",
      xmlId: "chain-b",
      sourceFormat: "pretext",
      type: "section",
      title: "Was chain-a",
      source: "",
    },
    {
      id: "16161616-1616-4161-8161-161616161616",
      xmlId: "chain-c",
      sourceFormat: "pretext",
      type: "section",
      title: "Was chain-b",
      source: "",
    },
  ],
});
markDeleted(renames, "division", "55555555-5555-4555-8555-555555555555");
writeFileSync(OUT + "projection_renames_state.bin", Y.encodeStateAsUpdate(renames));

console.log(`wrote collab fixtures to ${OUT}`);
