#!/usr/bin/env bash
#
# Build PreFigure's wasm engine from the prefigure repo at a pinned commit and
# put it in vendor/prefigure, where script/copy-static-assets.js serves it from.
#
# The engine is the Rust port of PreFigure compiled to WebAssembly
# (packages/prefig-wasm in https://github.com/davidaustinm/prefigure), in its
# MathJax variant: TeX labels are typeset by the host (the editor's worker
# bundles MathJax), which is what a real build does too, so the preview's labels
# look like the build's. The maintainer's advice is to use this build rather
# than the Python package under Pyodide; it is not published to npm, so it is
# built here and vendored.
#
# Needs: git, cargo with the wasm32-unknown-unknown target, wasm-pack.
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack
#
# Usage: script/build-prefig-wasm.sh [commit]
#   The commit defaults to PREFIGURE_COMMIT below; bump it (and
#   PREFIG_WASM_VERSION in packages/web-editor/src/generators/prefigure/worker/protocol.ts
#   when the crate version changes) to take a newer PreFigure.
set -euo pipefail

PREFIGURE_REPO="https://github.com/davidaustinm/prefigure"
PREFIGURE_COMMIT="${1:-8419e1a761cad804cd271a9a3e371ba3a5757b2d}"

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/vendor/prefigure"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Cloning prefigure at $PREFIGURE_COMMIT"
git clone --quiet --filter=blob:none "$PREFIGURE_REPO" "$work/prefigure"
git -C "$work/prefigure" checkout --quiet "$PREFIGURE_COMMIT"

echo "Building packages/prefig-wasm (MathJax variant) for the web"
(cd "$work/prefigure/packages/prefig-wasm" && wasm-pack build --target web --out-dir "$work/pkg" --out-name prefig_wasm)

for name in prefig_wasm.js prefig_wasm_bg.wasm prefig_wasm.d.ts; do
  cp "$work/pkg/$name" "$out/$name"
done
{
  echo "# Written by script/build-prefig-wasm.sh; do not edit."
  echo "commit=$PREFIGURE_COMMIT"
  echo "version=$(grep -m1 '^version' "$work/prefigure/packages/prefig-wasm/Cargo.toml" | sed 's/.*"\(.*\)"/\1/')"
  echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$out/BUILD"

echo "Wrote $out:"
ls -la "$out"
