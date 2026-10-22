// Take divisions' sources apart into their elements' fields and their bodies,
// for Rails.
//
// `DivisionSourceSplitter` spawns `node lib/assembler/split-divisions.mjs`
// (this file, bundled -- see `npm run build:assembler`), writes a JSON array of
// divisions to stdin, and reads the results back off stdout. Its one caller is
// the migration that moved every division's type, title, label and attributes
// out of its source and into columns (SplitDivisionMetadataOutOfSources).
//
// It is the web-editor's own `splitDivisionSource`, rather than a Ruby reading
// of the same three markup styles, for the reason SourceAssembler gives: the
// editor builds a division's element back from these fields
// (`wrapDivisionSource`), and the only way to be sure the two directions agree
// is for both to be the same code.
//
// Protocol, as blunt as the assembler's:
//
//   stdin   a JSON array of { id, source, source_format, fallback_type, fallback_title }
//   stdout  a JSON array, in the same order, of
//           { id, type, title, label, xml_id, attrs, body, wrapped, warnings }
//   stderr  diagnostics
//   exit 0  stdout is the array
//   exit 1  stdout is meaningless; stderr says why
import { splitDivisionSource } from "../packages/web-editor/src/sectionUtils.ts";

/** Read all of stdin as a UTF-8 string. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Write `text` and wait for the pipe to take it; see assemble-source.mjs. */
function writeStdout(text) {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, "utf8", (error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  const divisions = JSON.parse(await readStdin());
  if (!Array.isArray(divisions)) throw new Error("expected a JSON array of divisions");

  const results = divisions.map((division) => {
    const split = splitDivisionSource(division.source ?? "", division.source_format ?? "pretext", {
      type: division.fallback_type ?? undefined,
      title: division.fallback_title ?? undefined,
    });
    return {
      id: division.id,
      type: split.type,
      title: split.title,
      label: split.label,
      xml_id: split.xmlId,
      attrs: split.attrs,
      body: split.body,
      wrapped: split.wrapped,
      warnings: split.warnings,
    };
  });
  await writeStdout(JSON.stringify(results));
}

main().catch((error) => {
  process.stderr.write(`split-division-sources: ${error?.stack ?? error}\n`);
  process.exit(1);
});
