// Assemble a project's standalone PreTeXt document, for Rails.
//
// `SourceAssembler` spawns `node lib/assembler/assemble.mjs` (this file,
// bundled -- see `npm run build:assembler`), writes a project's JSON to stdin,
// and reads the assembled `<pretext>` document back off stdout. Nothing else
// calls it.
//
// It exists because the assembler is JavaScript and only JavaScript: resolving
// `<plus:* ref="..."/>` placeholders and converting latex/markdown divisions to
// PreTeXt is ~3,400 lines built on xast-util and the content converters, with
// no Ruby equivalent to reach for. The browser used to run it on every autosave
// and PATCH the result into `projects.pretext_source`; nothing reads or writes
// that column now, and this is what replaced it.
//
// The input is the same project JSON the editor loads
// (`projects/_project.json.jbuilder`), and `assembleProjectJson` is the same
// function the editor's own save path used to call. Both halves of that are
// deliberate: the document a build consumes has to be the one the author was
// looking at, and the cheapest way to be sure is to leave one implementation
// and give the server a way to call it.
//
// Protocol, kept blunt because a build's correctness rides on it:
//
//   stdin   one JSON object, the project
//   stdout  the assembled document, UTF-8, and nothing else
//   stderr  diagnostics
//   exit 0  stdout is the document
//   exit 1  stdout is meaningless; stderr says why
//
// Note the empty-document case is a success, not a failure: a project with no
// root division assembles to "", exactly as the editor's save path produced ""
// for it. Deciding what to do about that is the caller's business.
import { assembleProjectJson } from "../app/javascript/controllers/react/railsProjectMapping.js";

/** Read all of stdin as a UTF-8 string. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Written with an explicit callback rather than awaited: process.stdout is
// non-blocking on a pipe, so a document larger than the pipe buffer is still
// in flight when the script would otherwise return, and Node can exit with it
// half-written. Waiting for the flush is what makes a big book safe.
/** @param {string} text */
function writeStdout(text) {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, "utf8", (error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  const input = await readStdin();
  if (!input.trim()) throw new Error("no project JSON on stdin");

  let json;
  try {
    json = JSON.parse(input);
  } catch (error) {
    throw new Error(`project JSON did not parse: ${error.message}`);
  }

  await writeStdout(assembleProjectJson(json));
}

main().catch((error) => {
  process.stderr.write(`assemble-source: ${error?.stack ?? error}\n`);
  process.exit(1);
});
