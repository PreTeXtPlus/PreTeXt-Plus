#!/usr/bin/env node
// Fetches the TikZ engine into public/engines/<name>-<version>/, where the editor's
// TikZ worker loads it from (see tikz_engine_url in ProjectsHelper).
//
// The engine is mp-tikz-wasm (https://github.com/jmckalex/mp-tikz-wasm): pdfTeX and
// dvisvgm compiled to WebAssembly, plus the TeX tree they read one file at a time.
// It is not on npm, and at about 70 MB it does not belong in the repo, so the release
// named in config/tikz_engine.json is downloaded and checked against its sha256.
//
// This is not part of `npm run build`, which runs in watch mode all through development
// and should not depend on the network being up. Without the engine TikZ assets show
// their stored picture and render nothing live, so assets:precompile runs this on every
// deploy (lib/tasks/tikz_engine.rake), and bin/setup does in development. It does nothing
// when the pinned release is already there.
//
// Usage: node script/fetch-tikz-engine.js [directory]

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const pin = require("../config/tikz_engine.json");

const out = path.resolve(
  process.argv[2] ?? path.join(__dirname, "..", "public", "engines", `${pin.name}-${pin.version}`),
);
const stamp = path.join(out, ".fetched");

// What the worker loads, out of everything the release carries (mirrors TIKZ_BUNDLES in
// the worker's protocol.ts). Left out, the library's default `luatex` bundle: the worker
// only ever runs pdfTeX, and the build's xelatex has no \directlua for it to stand in
// for. Also its opt-in bundles, `classico` above all: its fonts' licence forbids
// commercial redistribution.
const bundles = pin.bundles;
const isEngineFile = (name) => /^(mplib|tex|dvisvgm)\.(mjs|wasm)$|^luatex\.mjs$/.test(name);

const copyTree = (from, to, keep = () => true) => {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => !path.basename(source).startsWith("._") && keep(source),
  });
};

async function main() {
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === pin.sha256) {
    console.log(`${pin.name} ${pin.version} is already in ${out}`);
    return;
  }

  console.log(`Fetching ${pin.url}`);
  const response = await fetch(pin.url);
  if (!response.ok) throw new Error(`${pin.url}: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());

  const sha256 = crypto.createHash("sha256").update(archive).digest("hex");
  if (sha256 !== pin.sha256) {
    throw new Error(`${pin.name} ${pin.version}: expected sha256 ${pin.sha256}, got ${sha256}`);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tikz-engine-"));
  try {
    const tarball = path.join(work, "engine.tar.gz");
    const unpacked = path.join(work, "unpacked");
    fs.writeFileSync(tarball, archive);
    fs.mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", tarball, "-C", unpacked, "--strip-components=1"], { stdio: "ignore" });

    const staged = `${out}.partial`;
    fs.rmSync(staged, { recursive: true, force: true });
    fs.mkdirSync(path.join(staged, "bundles"), { recursive: true });

    // Every JS module, wherever it sits (dist/ imports across subdirectories), and the engines.
    const dist = path.join(unpacked, "dist");
    copyTree(dist, staged, (source) => {
      const relative = path.relative(dist, source);
      if (relative === "bundles" || relative.startsWith(`bundles${path.sep}`)) return false;
      return fs.statSync(source).isDirectory() || source.endsWith(".js") || isEngineFile(path.basename(source));
    });
    for (const file of ["hot.json", "index.json"]) {
      fs.copyFileSync(path.join(dist, "bundles", file), path.join(staged, "bundles", file));
    }
    for (const bundle of bundles) {
      copyTree(path.join(dist, "bundles", bundle), path.join(staged, "bundles", bundle));
    }

    // The engines are GPL and the library LGPL; their terms travel with them.
    for (const file of ["LICENSE", "NOTICE.md"]) {
      fs.copyFileSync(path.join(unpacked, file), path.join(staged, file));
    }
    copyTree(path.join(unpacked, "licenses"), path.join(staged, "licenses"));
    fs.writeFileSync(path.join(staged, ".fetched"), `${pin.sha256}\n`);

    fs.rmSync(out, { recursive: true, force: true });
    fs.renameSync(staged, out);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
