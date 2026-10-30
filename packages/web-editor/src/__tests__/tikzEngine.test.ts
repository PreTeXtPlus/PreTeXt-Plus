/**
 * The real TikZ engine, through the worker's handler: plan 7.3's spike, the part
 * Node can do. Not part of the default suite, since it executes the release that
 * `script/fetch-tikz-engine.js` downloads; opt in with
 *
 *   node script/fetch-tikz-engine.js
 *   RUN_TIKZ_ENGINE=1 npx vitest run tikzEngine   (from packages/web-editor)
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it, expect } from "vitest";
import {
  handleTikzWorkerRequest,
  resetTikzEngineForTests,
  type TikzEngine,
} from "../generators/tikz/worker/handler";
import { TIKZ_BUNDLES, type TikzWorkerResponse } from "../generators/tikz/worker/protocol";
import { generators } from "../generators";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const pin = JSON.parse(readFileSync(`${root}config/tikz_engine.json`, "utf8"));
const engineDir = `${root}public/engines/${pin.name}-${pin.version}/`;
const enabled = process.env.RUN_TIKZ_ENGINE === "1" && existsSync(`${engineDir}index.js`);

let token = 1;

/** One render through the handler, as the worker runs it. */
async function render(source: string, { preamble = "", macros = "" } = {}) {
  const posted: TikzWorkerResponse[] = [];
  const post = (response: TikzWorkerResponse) => posted.push(response);
  const createEngine = async () => {
    const { MetaPost } = await import(/* @vite-ignore */ `${engineDir}index.js`);
    return (await MetaPost.create({
      worker: false,
      bundles: [...TIKZ_BUNDLES],
      bundleBaseUrl: `${engineDir}bundles`,
      logLevel: "silent",
    })) as TikzEngine;
  };
  await handleTikzWorkerRequest({ type: "load", token: token++, baseUrl: engineDir }, post, { createEngine });
  const started = performance.now();
  await handleTikzWorkerRequest({ type: "render", token: token++, source, preamble, macros }, post);
  const response = posted[posted.length - 1];
  console.log(`${Math.round(performance.now() - started)} ms  ${response.type}  ${source.slice(0, 50).replace(/\n/g, " ")}`);
  return response;
}

const expectPicture = (response: TikzWorkerResponse) => {
  expect(response).toMatchObject({ type: "rendered" });
  return (response as Extract<TikzWorkerResponse, { type: "rendered" }>).svg;
};
const expectFailure = (response: TikzWorkerResponse) => {
  expect(response).toMatchObject({ type: "failed" });
  return (response as Extract<TikzWorkerResponse, { type: "failed" }>).message;
};

describe.runIf(enabled)("the real TikZ engine", { timeout: 60_000 }, () => {
  afterAll(() => resetTikzEngineForTests());

  it("compiles the starter, drawing glyphs as paths", async () => {
    const svg = expectPicture(await render(generators.tikz.starterSource));
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
  });

  it("compiles a tikzcd with \\amp", async () => {
    const source = "\\begin{tikzcd}\nA \\arrow[r, \"f\"] \\amp B\n\\end{tikzcd}";
    expectPicture(await render(source, { preamble: "\\usepackage{tikz-cd}" }));
  });

  it("refuses a tikzcd with a literal &, and names \\amp", async () => {
    const source = "\\begin{tikzcd}\nA \\arrow[r, \"f\"] & B\n\\end{tikzcd}";
    expect(expectFailure(await render(source, { preamble: "\\usepackage{tikz-cd}" }))).toContain("\\amp");
  });

  it("compiles a pgfplots axis", async () => {
    const source =
      "\\begin{tikzpicture}\\begin{axis}\\addplot[domain=0:6]{sin(deg(x))};\\end{axis}\\end{tikzpicture}";
    expectPicture(await render(source, { preamble: "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}" }));
  });

  it("compiles a circuitikz figure", async () => {
    const source = "\\begin{circuitikz}\\draw (0,0) to[R, l=$R$] (3,0);\\end{circuitikz}";
    expectPicture(await render(source, { preamble: "\\usepackage{circuitikz}" }));
  });

  it("takes a preamble TikZJax could not, with macros and escaped XML", async () => {
    const preamble = "\\usepackage[dvipsnames]{xcolor}\n\\usepackage{mathtools}\n\\usetikzlibrary{calc,arrows.meta}";
    const macros = "\\newcommand{\\R}{\\mathbb{R}}\\newcommand{\\lt}{&lt;}";
    const source = "\\begin{tikzpicture}\\node[ForestGreen] {$\\R \\lt 1$};\\end{tikzpicture}";
    expectPicture(await render(source, { preamble, macros }));
  });

  it("keeps a classic arrow tip on the page", async () => {
    const svg = expectPicture(await render("\\begin{tikzpicture}[>=latex]\\draw[->] (0,0) -- (2,0);\\end{tikzpicture}"));
    expect(svg).toContain("<path");
  });

  it("fails where the build would: an undefined command, a missing package, LuaTeX", async () => {
    expect(expectFailure(await render("\\tikz\\draw \\nosuchmacro;"))).toContain("Undefined control sequence");
    expect(expectFailure(await render("\\tikz;", { preamble: "\\usepackage{nosuchpackage}" }))).toContain("nosuchpackage");
    expectFailure(await render("\\directlua{tex.print('x')}"));
  });

  it("reads nothing outside its bundles", async () => {
    for (const path of ["https://example.com/x.tex", "/etc/passwd", "../../../../etc/hostname"]) {
      expect(expectFailure(await render(`\\input{${path}}\\tikz;`))).toContain("not found");
    }
  });
});
