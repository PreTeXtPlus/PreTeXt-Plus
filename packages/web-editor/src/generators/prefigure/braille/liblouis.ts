/**
 * Text → contracted (grade 2) Unified English Braille, through liblouis, for a
 * tactile diagram's text labels — the translation PreFigure's Python package
 * asks the `louis` bindings for (`en-ueb-g2.ctb`, with the label's typeform).
 *
 * liblouis is the playground's emscripten build (see README.md); its tables are
 * written into the build's in-memory file system on first use, where liblouis
 * looks for them by name.
 */
import { createLiblouis, type LiblouisModule } from "./liblouis/build-no-tables-utf32.js";
import tables from "./liblouis/tables.json";

const TABLE_DIRECTORY = "/usr/local/share/liblouis/tables";
const TABLE = "en-ueb-g2.ctb";

// liblouis's output is braille ASCII (the tables' display table is North
// American Braille ASCII); a tactile diagram wants Unicode braille cells.
// Indexed by character code − 32; from the playground's `brfToUnicode`.
const BRAILLE_ASCII =
  "⠀⠮⠐⠼⠫⠩⠯⠄⠷⠾⠡⠬⠠⠤⠨⠌⠴⠂⠆⠒⠲⠢⠖⠶⠦⠔⠱⠰⠣⠿⠜⠹⠈⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵⠪⠳⠻⠘⠸";

export function brailleAsciiToUnicode(ascii: string): string {
  let out = "";
  for (const char of ascii) {
    const code = char.codePointAt(0)!;
    // Lower case reads as upper case in braille ASCII; anything else outside
    // the table (control characters, cells already in Unicode) passes through.
    const index = (code >= 0x61 && code <= 0x7a ? code - 0x20 : code) - 32;
    out += index >= 0 && index < BRAILLE_ASCII.length ? [...BRAILLE_ASCII][index] : char;
  }
  return out;
}

let louis: LiblouisModule | null = null;

function liblouis(): LiblouisModule {
  if (louis) return louis;
  // Told which environment it is in, because its own guess fails in a module
  // worker under some bundlers and in Node's ESM; nothing it does differs
  // between them once the tables are in memory.
  const created = createLiblouis({
    ENVIRONMENT: "WEB",
    print: () => {},
    // It reports its own start-up time this way; anything else is worth seeing.
    printErr: (text) => void (text.startsWith("pre-main prep time") || console.warn(`liblouis: ${text}`)),
  });
  created.FS.mkdirTree(TABLE_DIRECTORY);
  for (const [name, data] of Object.entries(tables as Record<string, string>)) {
    created.FS.writeFile(`${TABLE_DIRECTORY}/${name}`, data);
  }
  louis = created;
  return louis;
}

/**
 * `text` in contracted UEB, as Unicode braille, trailing space trimmed (as the
 * Python package does). `typeform` gives each character's emphasis (liblouis
 * formtypes: italic, bold, …), as PreFigure passes it; all zeros means none.
 */
export function translateText(text: string, typeform: readonly number[] = []): string {
  if (text === "") return "";
  const lib = liblouis();
  const codePoints = [...text];
  // Contraction shortens text, but capital, number and emphasis indicators
  // lengthen it: room for four cells per character covers the worst case.
  const outCapacity = codePoints.length * 4 + 16;
  const inBytes = (codePoints.length + 1) * 4;
  const inBuffer = lib._malloc(inBytes);
  const outBuffer = lib._malloc(outCapacity * 4);
  const inLength = lib._malloc(4);
  const outLength = lib._malloc(4);
  const emphasized = typeform.some((t) => t !== 0);
  const forms = emphasized ? lib._malloc(codePoints.length * 2) : 0;
  try {
    lib.stringToUTF32(text, inBuffer, inBytes);
    lib.setValue(inLength, codePoints.length, "i32");
    lib.setValue(outLength, outCapacity, "i32");
    if (emphasized) {
      codePoints.forEach((_, i) => lib.setValue(forms + 2 * i, typeform[i] ?? 0, "i16"));
    }
    const ok = lib.ccall(
      "lou_translateString",
      "number",
      ["string", "number", "number", "number", "number", "number", "number", "number"],
      [TABLE, inBuffer, inLength, outBuffer, outLength, forms, 0, 0],
    );
    if (!ok) throw new Error(`liblouis could not translate “${text}” to braille`);
    const length = lib.getValue(outLength, "i32");
    const start = outBuffer >> 2;
    const ascii = String.fromCodePoint(...lib.HEAPU32.subarray(start, start + length));
    return brailleAsciiToUnicode(ascii).trimEnd();
  } finally {
    for (const pointer of [inBuffer, outBuffer, inLength, outLength, forms]) {
      if (pointer) lib._free(pointer);
    }
  }
}
