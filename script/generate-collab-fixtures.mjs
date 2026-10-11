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
      source: '<book xml:id="root"><title>Fixture Book</title></book>',
    },
  ],
});
writeFileSync(OUT + "seed_state.bin", Y.encodeStateAsUpdate(doc));

// One incremental update on top of that seed -- the shape of a keystroke.
const before = Y.encodeStateVector(doc);
doc.getMap("divisions").get(ROOT_ID).get("source").insert(5, ' xmlns:plus="https://pretext.plus"');
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
      source: "<book/>",
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
// divisions in different source formats, and tombstones for a division and an
// asset removed during the session.
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
      source: '<book xml:id="projected-root"><title>Projected Book</title></book>',
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      xmlId: "projected-ch1",
      sourceFormat: "latex",
      type: "chapter",
      title: "Chapter One",
      source: "\\chapter{One}\\label{projected-ch1}",
    },
  ],
});
markDeleted(projected, "division", "55555555-5555-4555-8555-555555555555");
markDeleted(projected, "asset", "66666666-6666-4666-8666-666666666666");
writeFileSync(OUT + "projection_state.bin", Y.encodeStateAsUpdate(projected));

// Snippets and assets as ProjectDocProjection reads them: each record's source
// is shared text (a nested Y.Text), like a division's. One asset the project
// knows, one it doesn't (an asset row is created by its upload, never by a
// projection), and a snippet removed during the session.
const records = new Y.Doc();
seedDocFromState(records, {
  title: "Records",
  docinfo: "<docinfo/>",
  divisions: [],
  snippets: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      ref: "projected-note",
      sourceFormat: "latex",
      source: "A \\emph{projected} note.",
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
writeFileSync(OUT + "projection_records_state.bin", Y.encodeStateAsUpdate(records));

console.log(`wrote collab fixtures to ${OUT}`);
