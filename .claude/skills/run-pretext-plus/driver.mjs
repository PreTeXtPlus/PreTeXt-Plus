#!/usr/bin/env node
// Drive the running PreTeXt-Plus app in headless Chromium, one command per
// line on stdin (a heredoc). Each run is a fresh browser.
//
//   node .claude/skills/run-pretext-plus/driver.mjs <<'EOF'
//   nav /tryit
//   wait-for role=button[name="Insert"]
//   screenshot tryit
//   EOF
//
// Selectors are Playwright selector strings: `role=menuitem[name="Lemma"]`,
// `text=Classic PreTeXt XML`, or plain CSS. The first visible match is used.
// Screenshots go to $OUT (default tmp/run-pretext-plus/), numbered in order.
// The first failing command saves error.png, prints the error and exits 1.
//
// Run `help` for the command list.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "tmp/run-pretext-plus";
const TIMEOUT = Number(process.env.TIMEOUT ?? 30000);

// Console output the app always produces, which says nothing about a change:
// the in-browser PreTeXt renderer logs its own diagnostics as console errors,
// and the preview page asks for a search index the dev server doesn't have.
// Chromium's own "Failed to load resource" line names no URL; the `http NNN:`
// entry recorded for the same response does, so only that one is kept.
const NOISE = [
  /^PTX:/,
  /^\s+located (at|within):/,
  /lunr-pretext-search-index/,
  /^Failed to load resource:/,
  // The banner a slideshow (reveal.js) preview prints on every render.
  /^\*+$/,
  /^-+$/,
  /^Conversion to reveal\.js presentations\/slideshows is experimental/,
  /^Requests for additional specific constructions welcome/,
  /^Additional PreTeXt elements are subject to change/,
];

const HELP = `
viewport W H            resize the page (default 1280 800)
fresh                   new browser context: no cookies (signed out), same viewport
nav PATH|URL            go to PATH relative to ${BASE}
login [EMAIL [PASS]]    sign in (default admin@example.com / password123, from db:seed)
wait-for SEL            wait until SEL is visible
wait-gone SEL           wait until SEL is hidden or gone (e.g. text=Preparing preview...)
wait-preview TEXT       wait until TEXT is visible inside the live-preview iframe
click SEL | hover SEL   act on the first match of SEL
fill SEL => TEXT        replace an input's value
type TEXT | press KEY   keyboard into whatever has focus (KEY: Escape, Enter, Control+S, ...)
sleep MS                wait
screenshot [NAME]       save $OUT/NN-NAME.png
url                     print the current URL
eval JS                 evaluate a JS expression in the page, print the result as JSON
editor-text             print the source in the visible code editor (Monaco)
cursor LINE COL         collapse the code editor's selection to LINE:COL and focus it
markers [OWNER|all]     print the code editor's markers (default owner: pretext-schema)
console [all]           print console errors / failed requests since the last call
help | quit
`.trim();

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let viewport = { width: 1280, height: 800 };
let context;
let page;
let shot = 0;
let logs = [];

async function newContext() {
  await context?.close();
  context = await browser.newContext({ viewport });
  page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.on("console", (m) => m.type() === "error" && logs.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && logs.push(`http ${r.status()}: ${r.url()}`));
}
await newContext();

// The first *visible* match: PreTeXt pages repeat headings in a table of
// contents that is hidden at narrow widths, and the bare first match is often
// that hidden copy.
const target = (sel) => page.locator(sel).filter({ visible: true }).first();

// The code editor is the visible Monaco instance; hidden ones (a closed
// docinfo editor, a pane kept mounted under a form) are skipped.
const EDITOR = `globalThis.monaco?.editor.getEditors().find((e) => e.getDomNode()?.offsetParent)`;

// Built as one expression string rather than an in-page `new Function`, which
// the app's Content-Security-Policy is entitled to refuse.
async function inEditor(body, arg) {
  const result = await page.evaluate(`(() => {
    const editor = ${EDITOR};
    const monaco = globalThis.monaco;
    const arg = ${JSON.stringify(arg ?? null)};
    ${body}
  })()`);
  if (result === "__no_editor__") throw new Error("no visible code editor on this page");
  return result;
}

const commands = {
  async viewport(w, h) {
    viewport = { width: Number(w), height: Number(h) };
    await page.setViewportSize(viewport);
  },
  async fresh() {
    await newContext();
  },
  async nav(where) {
    await page.goto(new URL(where, BASE).href);
  },
  async login(email = "admin@example.com", password = "password123") {
    await page.goto(new URL("/users/sign_in", BASE).href);
    await page.fill('input[name="user[email]"]', email);
    await page.fill('input[name="user[password]"]', password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/users/sign_in")),
      page.click('form input[type="submit"]'),
    ]);
    console.log(`signed in as ${email} -> ${page.url()}`);
  },
  async "wait-for"(...sel) {
    await target(sel.join(" ")).waitFor({ state: "visible" });
  },
  async "wait-gone"(...sel) {
    await page.locator(sel.join(" ")).first().waitFor({ state: "hidden" });
  },
  // The preview is an iframe that paints well after its "Preparing preview..."
  // overlay goes, so this is the wait that proves something rendered.
  async "wait-preview"(...text) {
    const started = Date.now();
    await page.frameLocator("iframe").first().getByText(text.join(" "))
      .filter({ visible: true }).first().waitFor({ state: "visible" });
    console.log(`preview shows it after ${Date.now() - started} ms`);
  },
  async click(...sel) {
    await target(sel.join(" ")).click();
  },
  async hover(...sel) {
    await target(sel.join(" ")).hover();
  },
  async fill(...rest) {
    const [sel, text = ""] = rest.join(" ").split(/\s+=>\s*/);
    await target(sel).fill(text);
  },
  async type(...text) {
    await page.keyboard.type(text.join(" "));
  },
  async press(key) {
    await page.keyboard.press(key);
  },
  async sleep(ms) {
    await page.waitForTimeout(Number(ms));
  },
  async screenshot(name = "shot") {
    shot += 1;
    const file = path.join(OUT, `${String(shot).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  },
  async url() {
    console.log(page.url());
  },
  async eval(...js) {
    console.log(JSON.stringify(await page.evaluate(js.join(" ")), null, 1));
  },
  async "editor-text"() {
    console.log(await inEditor(`return editor ? editor.getValue() : "__no_editor__";`));
  },
  async cursor(line, col) {
    await inEditor(
      `if (!editor) return "__no_editor__";
       editor.setSelection(new monaco.Range(arg[0], arg[1], arg[0], arg[1]));
       editor.focus();`,
      [Number(line), Number(col)],
    );
  },
  async markers(owner = "pretext-schema") {
    const found = await inEditor(
      `if (!editor) return "__no_editor__";
       return monaco.editor.getModelMarkers({ resource: editor.getModel().uri })
         .filter((m) => arg === "all" || m.owner === arg)
         .map((m) => m.owner + " " + m.startLineNumber + ":" + m.startColumn + " " + m.message);`,
      owner,
    );
    console.log(found.length ? found.join("\n") : `(no ${owner === "all" ? "" : owner + " "}markers)`);
  },
  async console(which) {
    const shown = which === "all" ? logs : logs.filter((l) => !NOISE.some((re) => re.test(l.replace(/^\w+: /, ""))));
    console.log(shown.length ? shown.join("\n") : "(nothing)");
    logs = [];
  },
  async help() {
    console.log(HELP);
  },
};

const rl = readline.createInterface({ input: process.stdin });
let failed = false;
for await (const raw of rl) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  if (line === "quit") break;
  const [name, ...args] = line.split(/\s+/);
  console.log(`> ${line}`);
  const run = commands[name];
  if (!run) {
    console.log(`unknown command: ${name} (try: help)`);
    continue;
  }
  try {
    await run(...args);
  } catch (error) {
    console.log(`! ${error.message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(OUT, "error.png") }).catch(() => {});
    console.log(`  (page at failure: ${path.join(OUT, "error.png")})`);
    failed = true;
    break;
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
