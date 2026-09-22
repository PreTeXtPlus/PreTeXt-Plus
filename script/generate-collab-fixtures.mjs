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
import { seedDocFromState } from "../packages/web-editor/src/collab/schema.ts";
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
      sourceFormat: "ptx",
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
      sourceFormat: "ptx",
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

console.log(`wrote collab fixtures to ${OUT}`);
