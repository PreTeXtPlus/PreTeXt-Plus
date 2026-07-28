# Repo consolidation: editor monorepo + local build servers

Plan of record for two related infra changes, parked until we're ready to pick them
back up. **Not started.**

## Context

pretext.plus currently spans four repos: this Rails app, `pretext-plus-editor`
(React component library), and two build servers (`pretext-plus-build` —
lite/synchronous preview HTML, `pretext-plus-build-full` — async full document
builds). Two concrete pain points came out of discussing whether to move to a
monorepo:

1. **The editor is consumed via a `file:` link during cross-repo dev work**, which
   breaks esbuild's module resolution (it follows the symlink to the editor's own
   `node_modules`, producing a second copy of React/Yjs — "Invalid hook call" and
   broken CRDT sharing) and requires a manual "publish to npm, then repin the
   version" step before every merge to `colab`. We confirmed `@pretextbook/web-editor`
   has no real consumers besides this Rails app today, so the fix is to fold it into
   this repo for good via an npm workspace, rather than keep patching the `file:`
   link.
2. **There's no way to run either build server locally against your own branch.**
   `.devcontainer/compose.yaml` only boots `rails-app` + `selenium` + `postgres`;
   manual (non-stubbed) testing falls through to the public instances, which lag dev
   work and need production credentials. The fix is to add both build servers as
   sibling checkouts wired into the devcontainer's compose stack, the same pattern
   already used for `pretext-plus-editor` today.

These are independent changes — do them as two separate PRs, in either order.

---

## Part 1 — Fold `pretext-plus-editor` into this repo as an npm workspace

### 1. Bring the code in with history preserved

The editor is checked out as a sibling at `/workspaces/pretext-plus-editor`. Use
`git subtree` (not a plain copy) so its commit history survives inside this repo:

```bash
git subtree add --prefix=packages/web-editor /workspaces/pretext-plus-editor main
```

This lands the full editor tree (`src/`, tests, configs) under
`packages/web-editor/` as a normal merge commit — `git log --follow` still works
back through the old repo's history.

### 2. Turn it into an npm workspace

- Root `package.json`: add `"workspaces": ["packages/web-editor"]`.
- Change the dependency from a pinned registry version to `"*"` so npm always
  resolves it to the local workspace package regardless of any stale published
  version: `"@pretextbook/web-editor": "*"`.
- This is the actual fix for the esbuild double-bundling bug, not just a
  convenience: with a real npm workspace, `packages/web-editor` never gets its own
  `node_modules/react` (react/react-dom/yjs/y-protocols stay declared as
  `peerDependencies` there and are installed exactly once, at the repo root).
  esbuild's directory walk from the workspace symlink's real path now terminates at
  the *same* root `node_modules` the Rails app uses. Once this is verified working
  (step 5), remove the now-unnecessary esbuild aliases from the root `build` script
  in package.json: `--alias:react=...`, `--alias:react-dom=...`, `--alias:yjs=...`,
  `--alias:y-protocols/awareness=...`.

### 3. Drop the dist/-boundary the package no longer needs

`packages/web-editor` currently builds to `dist/` (via `vite build --mode lib` +
`tsc -p tsconfig.build.json`) purely so it can be published as an npm package with
compiled JS and `.d.ts` types. With no external consumers, that boundary is now
just extra build machinery to keep in sync:

- Point the package's `main`/`module`/`exports`/`style` fields at `src/index.ts` and
  `src/index.css` (or wherever the current entry points are) instead of `dist/*`.
- Remove `tsconfig.build.json` and the `vite build --mode lib` step from
  `packages/web-editor/package.json`'s scripts; esbuild already transpiles TS
  on the fly for `app/javascript/*`, so it can consume the editor's `.ts`/`.tsx`
  source directly, the same way it treats first-party Rails JS.
- Keep `npm run dev` (the standalone Vite demo), `npm run lint`, `typecheck`, and
  `test` scripts in `packages/web-editor/package.json` as-is — they're unaffected
  and still useful for iterating on the editor in isolation.
- Root `package.json`'s `build` script no longer needs a separate "build the editor
  library first" step — one `esbuild` invocation now bundles everything, so
  `Procfile.dev`'s `js: npm run build -- --watch` line needs no change either.

### 4. Retire the standalone repo and its automation

- Delete `.github/workflows/update-web-editor.yml` from this repo — there's no more
  separate package version to poll npm for and auto-bump.
- In `pretext-plus-editor` on GitHub: archive the repo (don't delete — preserves
  issue/PR history and any external links) once the merge PR is in.
- Run `npm deprecate @pretextbook/web-editor "Merged into PreTeXt-Plus, see
  <rails-repo-url>"` so the still-live npm listing points people at the new home
  instead of going silently stale.
- Update this repo's README/CLAUDE.md to mention `packages/web-editor` as part of
  this repo's structure.

### 5. Verify the actual bug is fixed

Confirm empirically, don't assume:

- `rm -rf node_modules packages/web-editor/node_modules && npm install` from repo
  root, then confirm there is **no** `packages/web-editor/node_modules/react` (or
  `/yjs`) directory — only the root one should exist.
- `bin/dev`, open the editor in a browser, and exercise a division edit — confirm no
  "Invalid hook call" console error.
- Run the collaborative-editing system tests (the ones exercising `CollabBridge` /
  Yjs sync) to confirm two simulated clients still share CRDT state correctly,
  since that's exactly the behavior a duplicated Yjs instance would silently break.
- Full CI run (`scan_js`, `test`, `system-test` in `.github/workflows/ci.yml`) —
  these already run `npm ci` at repo root, which now installs and links the
  workspace automatically, so no CI workflow changes should be required.

---

## Part 2 — Run both build servers locally via the devcontainer

### 1. Clone both as siblings

Same pattern as `pretext-plus-editor`:

```bash
git clone https://github.com/PreTeXtPlus/PreTeXt-Plus-build /workspaces/pretext-plus-build
git clone https://github.com/PreTeXtPlus/pretext-plus-build-full /workspaces/pretext-plus-build-full
```

`.devcontainer/compose.yaml`'s existing `../..:/workspaces:cached` mount already
makes these visible inside the running `rails-app` container at
`/workspaces/pretext-plus-build*` — no new volume mount needed for that. What's
missing is running them as their own services and pointing Rails at them.

### 2. Add the lite build server (`pretext-plus-build`) as a compose service

It's a plain Flask app (`app.py`, `flask`/`flask-cors`/`gunicorn`/`pretext`/`prefig`
in `requirements.txt`) with no Dockerfile of its own. Add a service directly in
`.devcontainer/compose.yaml` that builds from the sibling checkout using a stock
Python image, installs requirements, and runs Flask in dev mode:

```yaml
  preview-build:
    image: python:3.12-slim
    working_dir: /app
    volumes:
      - ../../pretext-plus-build:/app
    environment:
      BUILD_TOKEN: devtoken
      DEVELOPMENT: "true"
      FLASK_APP: app.py
    command: sh -c "pip install -r requirements.txt && flask run --host=0.0.0.0 --port=5000"
```

(Confirm the exact Flask entrypoint/port when implementing — `app.py`'s run
invocation wasn't fully confirmed during planning; adjust `FLASK_APP`/`--port` to
match.)

### 3. Add the full build server (`pretext-plus-build-full`) via its own compose file

This one already ships a complete `compose.yaml` (redis + caddy + api + worker) and
a `Makefile` that exports `HOST_DATA_DIR`. Rather than duplicating those service
definitions, use Compose's `include:` to pull it in directly, so it stays in sync
with upstream changes:

```yaml
# .devcontainer/compose.yaml
include:
  - path: ../../pretext-plus-build-full/compose.yaml
    env_file: ../../pretext-plus-build-full/.env
```

- Have the setup step (`postCreateCommand` or a one-time manual step) copy
  `pretext-plus-build-full/.env.example` to `.env` — the fake-build mode it
  defaults to (`BUILD_IMAGE=alpine` + a scripted fake build) is exactly right for
  this use case: no 5GB `pretext-full` pull, no warm-image build, full pipeline
  (queue → worker → sandboxed container → artifact) still exercised for real.
- `HOST_DATA_DIR` must point at the *host*'s real path to
  `pretext-plus-build-full/data`, because the worker bind-mounts it into sibling
  build containers via the Docker socket (`docker-outside-of-docker`, already a
  devcontainer feature here — likely enabled with exactly this in mind). In a
  Codespace, `/workspaces` on the VM and inside the `rails-app` container should
  refer to the same tree, but **this is the one piece to validate hands-on rather
  than trust from reading code** — set
  `HOST_DATA_DIR=/workspaces/pretext-plus-build-full/data` and run `make test` from
  that repo to confirm the worker can actually see job directories it's handed. If
  path translation turns out to be unreliable inside the nested
  devcontainer-in-Codespace-in-Docker setup, fall back to running
  `pretext-plus-build-full`'s own `make up` in a separate terminal (outside the
  nested compose project) and just point Rails' dev credentials at whatever
  host:port it publishes — you lose "starts automatically with `bin/dev`" but keep
  everything else.

### 4. Point Rails at the local instances for dev

Two blockers found by reading the actual client code, both need a small fix:

- `app/services/full_build_server.rb`'s `url_for` hardcodes `https://#{host}` — a
  local Flask/Caddy instance won't have TLS. Add an optional `scheme` credential
  (default `"https"`, so production is unaffected):
  `Rails.application.credentials.dig(:full_build, :scheme) || "https"`.
- `app/jobs/set_html_source_job.rb:12` has the same hardcoded `https://` for the
  preview build server — same fix, same pattern, reading
  `Rails.application.credentials.dig(:preview_build, :scheme)`.

Then set local-only values in Rails' environment-specific credentials (`bin/rails
credentials:edit --environment development`), which override the base file only in
`development`:

```yaml
preview_build:
  host: "preview-build:5000"
  token: "devtoken"
  scheme: "http"
full_build:
  host: "<full-build-full's api or caddy service name>:8000"
  token: "testtoken" # matches .env.example's BUILD_TOKEN
  scheme: "http"
```

### 5. Document it

Add a short section to the README (near the existing `stub_build_server` note)
explaining that manual build-server testing now works out of the box in the
devcontainer, and how to opt into real (non-fake) full builds via
`pretext-plus-build-full`'s own `make warm-image` if someone needs to test actual
PreTeXt compilation rather than the fake pipeline.

## Verification

- Part 1: steps above (workspace install check, browser smoke test, collab system
  tests, CI).
- Part 2: rebuild the devcontainer, confirm `docker compose ps` shows
  `preview-build` and the full-build-server's `api`/`worker`/`redis`/`caddy`
  services running; trigger a preview (exercises `SetHtmlSourceJob`) and a full
  build (exercises `FullBuildServer` + `Build`/`BuildStatusChecker`) from the Rails
  UI against the local instances; confirm both return real (fake-pipeline) output
  rather than erroring on TLS or auth.