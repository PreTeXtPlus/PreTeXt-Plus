// Take divisions' sources apart into their elements' fields and their bodies,
// for Rails.
//
// `DivisionSourceSplitter` spawns `node lib/assembler/split-divisions.mjs`
// (this file, bundled -- see `npm run build:assembler`), writes a JSON array of
// divisions to stdin, and reads the results back off stdout. Its one caller is
// the migration that moved every division's type, title and attributes
// out of its source and into columns (SplitDivisionMetadataOutOfSources).
//
// It is the web-editor's own `splitDivisionSource`, rather than a Ruby reading
// of the same three markup styles, for the reason SourceAssembler gives: the
// editor builds a division's element back from these fields
// (`wrapDivisionSource`), and the only way to be sure the two directions agree
// is for both to be the same code.
//
// A division whose source names no element of its own -- a LaTeX introduction
// or conclusion, whose markup has no header command -- is typed by the
// placeholder that places it (`\plus{introduction}{id}`), which is the one
// durable record of what it is. That is why the array is a whole project, not
// an arbitrary batch: the placeholder lives in the parent's source.
//
// Protocol, as blunt as the assembler's:
//
//   stdin   a JSON array of { id, ref, is_root, source, source_format, fallback_type, fallback_title }
//   stdout  a JSON array, in the same order, of
//           { id, type, title, xml_id, attrs, body, wrapped, warnings }
//   stderr  diagnostics
//   exit 0  stdout is the array
//   exit 1  stdout is meaningless; stderr says why
import {
  parseDivisionRefsWithTypes,
  splitDivisionSource,
} from "../packages/web-editor/src/sectionUtils.ts";

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

/**
 * The type each placeholder in these sources names for the division it places,
 * by ref. The generic `division` alias names nothing. Two placeholders that
 * disagree are reported against the ref, and the first one read wins.
 */
function placeholderTypes(divisions) {
  const types = new Map();
  const conflicts = new Map();
  for (const division of divisions) {
    const refs = parseDivisionRefsWithTypes(division.source ?? "", division.source_format ?? "pretext");
    for (const ref of refs) {
      if (ref.generic) continue;
      const seen = types.get(ref.xmlId);
      if (seen === undefined) types.set(ref.xmlId, ref.type);
      else if (seen !== ref.type) conflicts.set(ref.xmlId, `placed as both ${seen} and ${ref.type}; kept ${seen}`);
    }
  }
  return { types, conflicts };
}

async function main() {
  const divisions = JSON.parse(await readStdin());
  if (!Array.isArray(divisions)) throw new Error("expected a JSON array of divisions");

  const { types, conflicts } = placeholderTypes(divisions);
  const results = divisions.map((division) => {
    // A root is placed by nothing; its fallback is the project's.
    const placed = division.is_root ? undefined : types.get(division.ref ?? "");
    const split = splitDivisionSource(division.source ?? "", division.source_format ?? "pretext", {
      type: placed ?? division.fallback_type ?? undefined,
      title: division.fallback_title ?? undefined,
    });
    const warnings = [...split.warnings];
    if (!split.wrapped && placed !== undefined && conflicts.has(division.ref)) {
      warnings.push(conflicts.get(division.ref));
    }
    return {
      id: division.id,
      type: split.type,
      title: split.title,
      xml_id: split.xmlId,
      attrs: split.attrs,
      body: split.body,
      wrapped: split.wrapped,
      warnings,
    };
  });
  await writeStdout(JSON.stringify(results));
}

main().catch((error) => {
  process.stderr.write(`split-division-sources: ${error?.stack ?? error}\n`);
  process.exit(1);
});
