---
name: run-pretext-plus
description: Build, start, and drive the PreTeXt-Plus Rails app and its in-browser editor (packages/web-editor). Use when asked to run or start the app, rebuild its JS/CSS, take a screenshot of the editor, menus, or live preview, check schema lint markers, sign in and open a project, or run the Rails / web-editor tests.
---

PreTeXt-Plus is a Rails app whose editor is the React library in
`packages/web-editor`, bundled into `app/assets/builds/` by esbuild. An agent
drives it by starting `bin/rails server` and piping commands to
`.claude/skills/run-pretext-plus/driver.mjs`, a headless-Chromium (Playwright)
command runner with helpers for the code editor (Monaco), its lint markers and
the live preview. `chromium-cli` is not installed here; this driver stands in
for it.

All paths are relative to the repo root.

## Prerequisites

The devcontainer provides Ruby, Node 24, a Postgres service (`DB_HOST=postgres`)
and Playwright's Chromium (its `postCreateCommand`). Check Postgres answers:

```bash
pg_isready -h "$DB_HOST"
```

## Setup

```bash
bin/setup --skip-server             # bundle install, npm install, db:prepare
npx playwright install chromium     # no-op when already installed
```

Sign-in uses the dev admin. Ensure it exists (idempotent; do **not** reach for
`bin/rails db:seed` just for this, since it reloads fixtures over the dev data):

```bash
bin/rails runner 'u = User.find_or_initialize_by(email: "admin@example.com"); u.password = "password123"; u.admin = true; u.skip_confirmation!; u.save!; puts "#{u.email} ready"'
```

## Build

The server serves prebuilt bundles, so build after any change to
`packages/web-editor` or `app/javascript` (JS), or to Tailwind classes (CSS):

```bash
npm run build
bin/rails tailwindcss:build
```

A running server picks up a rebuild on the next page load (new digest); no
restart needed.

## Run (agent path)

Start the server in the background and wait for it:

```bash
bin/rails server -p 3000 > log/agent-server.log 2>&1 &
timeout 120 bash -c 'until curl -sf http://localhost:3000/up >/dev/null; do sleep 1; done' && echo "server up"
```

Drive it: one command per line on stdin, `#` for comments. Each run is a
fresh browser; it stops at the first failing command, saves `error.png`, and
exits 1.

```bash
node .claude/skills/run-pretext-plus/driver.mjs <<'EOF'
nav /tryit
wait-for role=button[name="Insert"]
# /tryit opens on a LaTeX-style division; switch to the PreTeXt XML one
click text=Classic PreTeXt XML
wait-for text=<section xml:id="tryit-xml">
click role=button[name="Insert"]
screenshot insert-menu
press Escape
cursor 3 1
type <bogus/>
sleep 3000
markers
console
EOF
```

prints `pretext-schema 3:1 tag not allowed here` and `(nothing)`, with
`tmp/run-pretext-plus/01-insert-menu.png` on disk.

The signed-in editor: list the admin's projects, then open one.

```bash
bin/rails runner 'puts User.find_by(email: "admin@example.com").projects.order(:created_at).pluck(:id, :title).map { _1.join("  ") }'
node .claude/skills/run-pretext-plus/driver.mjs <<'EOF'
login
nav /projects/4665f1d4-586f-4677-bb30-31cce67e60c4/edit
wait-preview Course Information
screenshot calculus
viewport 390 844
click role=button[name="Insert"]
screenshot phone-insert
EOF
```

Screenshots land in `tmp/run-pretext-plus/NN-NAME.png`, numbered from 01 in
each run (override the directory with `OUT=`). `BASE_URL=` and `TIMEOUT=` (ms, default 30000) are also read.

| command | what it does |
|---|---|
| `nav PATH` | go to `PATH` on `http://localhost:3000` |
| `login [EMAIL [PASS]]` | sign in (default the dev admin), lands on `/projects` |
| `fresh` | new context, so signed out (needed before `/tryit` after `login`) |
| `viewport W H` | resize (default 1280×800; 390×844 for phone) |
| `wait-for SEL` / `wait-gone SEL` | wait for the first visible match to show / for a match to go |
| `wait-preview TEXT` | wait until `TEXT` is visible in the live-preview iframe; prints how long it took |
| `click SEL` / `hover SEL` | act on the first visible match |
| `fill SEL => TEXT` / `type TEXT` / `press KEY` | input; `type`/`press` go to whatever has focus |
| `cursor LINE COL` | collapse the code editor's selection there and focus it |
| `editor-text` | print the open buffer |
| `markers [OWNER\|all]` | print the buffer's markers (default `pretext-schema`; also `pretext-spellcheck`) |
| `screenshot [NAME]` / `url` / `eval JS` / `sleep MS` | the usual |
| `console [all]` | console errors, page errors and HTTP ≥400 since the last call, minus known noise |

Selectors are Playwright selector strings: `role=menuitem[name="Theorem-like"]`,
`text=Classic PreTeXt XML`, or CSS.

Stop the server:

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

## Run (human path)

`bin/dev` runs foreman on `Procfile.dev`: the server plus esbuild and Tailwind
watchers, so rebuilds are automatic. It's a foreground process; Ctrl-C stops it.

## Test

Most PRs touch either the web-editor library or Rails; each has a direct
path that needs no server.

```bash
npm run test --workspace=packages/web-editor -- src/__tests__/snippets.test.ts   # one file; drop the path for all (~1000 tests)
npm run typecheck --workspace=packages/web-editor && npm run lint --workspace=packages/web-editor
bin/rails test test/models/announcement_test.rb                                  # one file; `bin/rails test` for all
```

## Gotchas

- **`/tryit` starts in LaTeX.** Its root division is LaTeX-style, so
  PreTeXt-only things (Insert's Interactive Exercises, Format PreTeXt) are
  absent until you `click text=Classic PreTeXt XML`. The contents row's label
  is truncated on screen; match the full title.
- **`/tryit` refuses signed-in users** (redirects to `/projects`). `fresh`
  before going back to it after `login`.
- **Escape out of a menu returns focus to the menu button**, not the editor,
  so a following `type` lands nowhere. `cursor LINE COL` first.
- **A menu insert replaces the editor's selection**, and a snippet leaves its
  first placeholder (usually the `xml:id`) selected. Two inserts in a row nest
  the second inside the first's attribute. `cursor` between inserts.
- **"Preparing preview..." clears seconds before the preview paints** (3–4 s
  more for a book or slideshow). `wait-preview TEXT` is the wait that proves it
  rendered; `wait-gone text=Preparing preview...` is not.
- **PreTeXt pages repeat headings in a hidden table of contents.** A bare
  first match lands on the hidden copy and never becomes visible; the driver
  always takes the first *visible* match. Raw Playwright needs
  `.filter({ visible: true })`.
- **Role names are exact.** `role=menuitem[name="Theorem"]` matches nothing
  when the row reads "Theorem-like"; use `name=/Theorem/` for a partial match.
- **Schema lint needs the network and a moment.** The grammar is fetched from
  cdn.jsdelivr.net and linting is debounced, so `sleep 3000` before
  `markers`. An empty list is also what a failed grammar load looks like;
  type a `<bogus/>` to prove the linter is live.
- **Known console noise is filtered** (`console all` shows it): the
  renderer's `PTX:` diagnostics, the reveal.js banner every slideshow preview
  prints, and the 404 for `lunr-pretext-search-index.js`.

## Troubleshooting

- **`locator.waitFor: Timeout 30000ms exceeded` on a menu item in `/tryit`**:
  the open division is LaTeX, which doesn't offer it. Open
  `text=Classic PreTeXt XML` first.
- **`getByText('Classic PreTeXt', { exact: true })` times out**: the row's
  text is "Classic PreTeXt XML".
- **A change to `packages/web-editor` doesn't show up**: the server serves
  `app/assets/builds/application.js`. `npm run build`, then `nav` again.
