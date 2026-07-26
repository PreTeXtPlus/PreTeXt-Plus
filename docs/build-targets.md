# Build targets

Plan of record and running status for turning the single hardcoded `web` build into a set
of user-managed output targets (html, pdf, epub, kindle, braille, revealjs, latex, and
custom variants).

Companion design docs (clickable mockups of the three screens):

- Interface proposal — <https://claude.ai/code/artifact/89a1520a-a005-49c8-9863-f383c7112358>
- Implementation plan — <https://claude.ai/code/artifact/846ac33e-f8dd-445a-bc00-2d7f1872ba6f>

---

## Status

Branch `builds`, based on `fbf2b0d` (`git log fbf2b0d..HEAD` for the commits, one per PR).
**Not deployed, not merged.**

| | |
|---|---|
| PRs 1–4 | **Done** — see the per-PR sections below, each with what shipped and how it differs from the original plan |
| PR 5 (retire the quick build) | **Not started.** The only remaining implementation work |
| Suite | 268 tests / 737 assertions green; rubocop and brakeman clean |
| Migrations | Four, all applied in dev. See *Deploying* below before running in production |

### What has never actually run

Three things are implemented and tested but unproven against reality. A fresh session
should not assume they work:

1. **No format other than html has ever been built.** The generated `project.ptx` is
   schema-valid and the plumbing is unit-tested, but the first real `pdf` / `epub` /
   `braille` build against `pretext-plus-build-full` is the actual proof. Most likely
   places to break: whether the server writes to `output/<target-name>/` as
   `ProjectArchiveBuilder` assumes, and whether `entry_path` detection picks the right
   file for braille.
2. **Nothing has been published end-to-end through a browser.** `PublishedController` is
   covered by integration tests, but no real built site has been served through `/o/…`,
   so relative links, the search index and knowls are unverified in situ.
3. **The drawer and live-updating rows are unverified in a browser.** There is no Chrome
   in the dev container, so `bin/rails test:system` cannot run locally; CI has Chrome and
   will exercise them. Integration tests assert the Stimulus/Turbo wiring those depend on,
   which is not the same as watching it work.

### Where the code lives

| Concern | Files |
|---|---|
| Model | `app/models/target.rb`, `build.rb`, plus `touch:` on `division.rb` / `asset.rb` and callbacks in `project.rb` |
| Dashboard | `app/views/projects/show.html.erb`, `app/views/targets/_target.html.erb`, `app/helpers/targets_helper.rb` |
| Drawer | `app/views/targets/show.html.erb`, `app/javascript/controllers/drawer_controller.js`, `TargetsController#show` |
| Building | `BuildsController`, `FullBuildJob`, `FullBuildArtifactJob`, `BuildCallbacksController`, `BuildStatusChecker` |
| Public output | `app/controllers/published_controller.rb` + `app/controllers/concerns/serves_build_files.rb` (shared with `BuildFilesController`) |
| Manifest | `app/services/project_archive_builder.rb` |
| Tests | `test/models/target_test.rb`, `test/controllers/{targets,builds,published}_controller_test.rb`, `test/jobs/entry_path_detection_test.rb`, `test/services/project_archive_builder_test.rb` |

### Deploying

Four migrations, in order: `source_updated_at` on projects, `create_targets`,
`latest_build_id`, then `compression` + `entry_path`.

`CreateTargets` sets `builds.target_id` NOT NULL in the same migration that backfills it,
so **check `Build.where.missing(:project).count` is zero in production first** — a build
with no project would get no target and the NOT NULL would fail the migration.

`config/cable.yml` changed for development only; production still uses `solid_cable`.

---

## The modeling change

`Build` used to do two jobs: it was the record of an attempt *and* the thing a reader
visited. That works with exactly one output. With several, "which build is my PDF?" has no
answer the interface can give.

So a **target** is now a first-class, persistent object — name, format, published flag,
current state — and builds become its history. This mirrors how PreTeXt-CLI already works:
`project.ptx` declares a list of named targets, and several targets may share a format
(a "student" and an "instructor" HTML, say). Target *names* are unique within a project;
formats are not.

```
Project ──< Target ──< Build ──< BuildFile
                │
                ├── current_build ── the latest *successful* build (what readers see)
                └── latest_build  ── the most recent attempt (what the pill reports)
```

Both pointers are denormalized onto `targets` and kept in step by
`Target#sync_from_builds!`, called from `Build` on create, destroy and every status
transition. They diverge exactly when a rebuild fails over a published output. Keeping
both on the row is also what makes `Target#state` free of queries, so a page rendering
many targets costs a fixed number.

### Five states

One state set, used identically on the projects list, the dashboard and the drawer. The six
database statuses collapse into these — `pending`, `in_progress`, `sent_to_server` and
`received_from_server` are all "Building" to an author.

| State | Meaning |
|---|---|
| `current` | Built after the last source edit. Nothing to do. |
| `stale` | Source changed since this built. |
| `building` | Queued or running. |
| `failed` | Last attempt failed. Any previous good output stays live. |
| `never` | Configured but never run. |

`state` describes the last **attempt**. `current_build` describes what readers **see**.
They are independent, and that is the point: a rebuild failing while a target is published
must not take the published output down, and the row has to say both things at once.

---

## Preflight findings

Three things checked against the working tree at `fbf2b0d` before any code was written.

### 1. Editing a document does not update `project.updated_at` (confirmed bug)

The editor saves through `ProjectsController#update` with `divisions_attributes`. Because no
attribute on the `projects` row itself changes, Rails never issues an `UPDATE` on the parent
— only on the division. Verified with `bin/rails runner`:

```
project.updated_at BEFORE:                       2026-07-22T20:30:51.284206Z
project.updated_at AFTER nested division change: 2026-07-22T20:30:51.284206Z   <- unchanged
division.updated_at:                             2026-07-26T01:58:23.285658Z
```

Consequences that already exist on `main`:

- "Last updated: 2 hours ago" on the projects index reports the last time someone renamed
  the project, not the last time they wrote a sentence.
- `default_scope { order(updated_at: :desc) }` on `Project` mis-sorts the list for the same
  reason.

And the one that blocks this work: *out of date* means "the last successful build is older
than the last source edit", and there is no trustworthy timestamp for the right-hand side.

**Fix:** `projects.source_updated_at`, bumped by `belongs_to :project, touch: :source_updated_at`
on `Division` and `Asset` (which also bumps `updated_at`, fixing the sort), plus a `Project`
callback for changes to `pretext_source` / `docinfo` / `document_type`.

A separate column rather than reusing `updated_at`, because renaming a project, publishing an
output, or reordering targets all touch `updated_at` and none of them should mark the PDF out
of date.

### 2. Every build status write bypasses model callbacks

All eleven status transitions use `update_column` / `update_columns`:

| File | Sites |
|---|---|
| `app/jobs/full_build_job.rb` | 5 |
| `app/jobs/full_build_artifact_job.rb` | 3 |
| `app/controllers/build_callbacks_controller.rb` | 2 |
| `app/services/build_status_checker.rb` | 1 |

Deliberate and fine today. But the live-updating rows in the new dashboard need a broadcast on
every transition, and an `after_update_commit` hook would silently never fire.

**Fix:** route all of them through `Build#mark!`, so there is exactly one place that knows how
to record a transition and (from PR 2) announce it.

### 3. Do not name the column `format`

`Kernel#format` is a private instance method on every object. An ActiveRecord attribute called
`format` overrides it, so a later `format("%.1f", x)` inside a `Target` method breaks in a way
that reads like a typo. Use `output_format`, which also matches `Division#source_format`.

---

## Schema

| Change | Shape | Purpose |
|---|---|---|
| `targets` | new table, uuid pk | The persistent output. |
| `targets.current_build_id` | uuid | Latest successful build — what readers see. |
| `targets.latest_build_id` | uuid | Most recent attempt — what the state pill reports. Added in PR 2, once it became clear `Target#state` could not be query-free without it. |
| `targets.compression` | string | `zip` or `scorm`, html only. PreTeXt has no `scorm` *format*; packaging is a separate axis. Added in PR 4. |
| `builds.target_id` | uuid, not null, fk | A build is an attempt at a target. `project_id` stays as a denormalization so existing nested routes keep working. |
| `builds.entry_path` | string | What to open for this build — `index.html` for a site, the artifact for a pdf. Detected at import. Added in PR 4. |
| `projects.source_updated_at` | datetime, not null | When the author last changed source, docinfo or assets. |

Both build pointers deliberately have **no** foreign key constraint. One would be circular
(`targets.current_build_id -> builds.id -> targets.id`) and would fight
`dependent: :destroy`. `Build#sync_target` keeps them honest instead, recomputing both
whenever a build is created, transitions, or is destroyed.

---

## The PRs

Each is independently deployable. The first three needed nothing from
`pretext-plus-build-full`, so the interface shipped before any new format existed. Each
section below records what actually shipped, including where it diverged from the plan and
why — those divergences are the parts worth reading.

### PR 1 — Targets exist  *(no visible UI change)* — **done**

Pure plumbing. Every existing project gets one `web` target that adopts its builds. The admin
builds pages keep working throughout.

- `AddSourceUpdatedAtToProjects` — column, backfill from the newest of the project and
  anything it owns, `NOT NULL`.
- `CreateTargets` — table, one `web` target per existing project, adopt existing builds,
  point `current_build_id` at the newest successful build per target.
- `Target` model with `state` / `stale?` / `sync_from_builds!`. (Shipped as `adopt!` plus
  `refresh_current_build!`; PR 2 consolidated the pair into one recompute.)
- `Build#mark!` replacing all eleven `update_column` sites.
- `Division` / `Asset` touch `source_updated_at`.
- `Project` gets a default `web` target on create, and copies targets in `full_dup`.

### PR 2 — The dashboard  *(iframe out, target rows in)* — **done**

- `projects/show` becomes the target list. Delete `projects/_project.html.erb` (the preview
  iframe) and both `builds/` views.
- New `TargetsController#show` — the drawer: history, log, settings.
- `builds#create` moves under the target and returns a Turbo Stream that swaps the row into
  its building state.
- `Target#broadcast_row`, called from `Build#mark!`. Replaces the
  `<meta http-equiv="refresh" content="5">` at the top of `builds/show`.
- Projects index: cards become rows with an `Edit` button and a chip strip.

**Dev cable, as shipped:** development now uses the `postgresql` adapter rather than
`async`. Builds broadcast from a `solid_queue` worker — a separate process under `bin/dev`
— and `async` only delivers within one process, so rows would have live-updated in
production and looked frozen locally. `postgresql` uses LISTEN/NOTIFY on the primary
database, so it crosses the process boundary without the separate `cable` database that
production's `solid_cable` needs and development does not have.

**N+1, as shipped:** `includes(targets: [ :current_build, :latest_build ])`, guarded by a
query-count test that adds targets and asserts the count does not move. The first cut
eager-loaded only `current_build` and still went N+1, because `Target#state` also called
`building?` and `latest_build`, each a query per target. That is what motivated the second
denormalized pointer.

**Build access, as shipped:** opened to all project owners rather than admins only — the
dashboard is not worth much if the only thing most users can do is look at it. Spend is
bounded in `BuildsController` instead: a 20/hour rate limit, and `MAX_CONCURRENT_BUILDS`
in-flight builds per user.

**Still on the quick build:** `projects#share` remains linked from the dashboard as
"Quick preview", and stays embedded on the public `projects#source` page, until publishing
gives every project a real html build to point at. Retired in PR 5.

### PR 3 — Publish and download  *(the part authors are asking for)* — **done**

- `Ability`: the owner rules (`can :manage, Target` / `can :manage, Build`) landed in
  PR 2. What remains is the anonymous read rule:

  ```ruby
  can :read, Build do |build|
    build.target.published? && build.target.current_build_id == build.id
  end
  ```

  The `current_build_id == build.id` clause is what makes unpublishing effective and keeps
  superseded builds private.
- Public output route `GET /o/:project_id/:target_name(/*relative_path)`, reusing
  `BuildFilesController`'s existing path resolution and blob caching.
- Per-target output download (already exists as `build.zip`) and a full project zip —
  `ProjectArchiveBuilder` already emits a valid PreTeXt-CLI project, so this is a controller
  action and a `send_data`.

**Do not break existing share links.** `/projects/:id/share` URLs are already in the world,
possibly in syllabi. Keep the route permanently and 301 it to the html target's published URL.
The three `lunr-pretext-search-index.js` redirects and the `get ":id/*_.html"` catch-all exist
because built PreTeXt HTML uses relative links — replicate them under `/o/…` or published
sites will 404 on search and cross-chapter navigation.

**Shipped in PR 3:** `/o/:project_id/:target_name/*path` served by `PublishedController`,
sharing `ServesBuildFiles` with `BuildFilesController`. `BuildFilesController` stays
login-only on purpose, so published output has exactly one anonymous surface and
unpublishing cannot be worked around by addressing the build directly. `projects#download`
returns the CLI zip. `Ability` gained `:download` on Project (the owner list is
deliberately explicit, so it had to be named).

**No trailing slash.** Rails normalizes trailing slashes away during route recognition —
`/o/x/web` and `/o/x/web/` are indistinguishable by the time a controller runs, and only
`request.original_fullpath` still knows. Rather than depend on that, both bare forms 302
to an explicit `/o/x/web/index.html`, which puts the visitor one level inside the target
so the built page's relative links resolve.

> ⚠ Published output is user-authored HTML **and JavaScript** served from the
> application's own origin. This predates PR 3 but publishing widens it, and the URL shape
> is now fixed. Nothing was applied; see
> [Open security decision](#open-security-decision-user-content-on-the-primary-origin).

### PR 4 — More formats — **done**

- `ProjectArchiveBuilder::TARGET` is gone; `project.ptx` lists every target.
- `FullBuildJob` submits `build.target.name`; `FullBuildArtifactJob` strips
  `"#{build.target.name}/"`.
- `builds.entry_path`, detected at import; `Target#entry_path` prefers it.
- "+ Add output" UI, and `User#target_quota` (4 free / 12 subscribed / 50 admin).

**The format list is not what PR 1 guessed.** PreTeXt's own
[`schema/project-ptx.rnc`](https://github.com/PreTeXtBook/pretext-cli/blob/main/schema/project-ptx.rnc)
is authoritative: `@format` is one of `html`, `pdf`, `latex`, `epub`, `kindle`,
`braille`, `revealjs`, `beamer`, `webwork`, `custom`.

- **There is no `scorm` format.** A SCORM package is
  `<target format="html" compression="scorm">`, so packaging is a separate axis and
  `targets.compression` carries it. The PR 1 enum had `scorm` as a *format*, which would
  have produced a manifest the CLI rejects. Enum value 4 was reused for `latex`, safe
  only because no row had ever used it.
- A test asserts every enum value is one the schema accepts, so a future format cannot
  silently break every build of that target.

**Entry points are recorded, not guessed.** The schema allows `@output-filename` on
`pdf`, `latex`, `epub`, `kindle` and `revealjs`, so the manifest names those artifacts
after the target and their path is known before the build runs. `braille` takes no such
attribute, so `FullBuildArtifactJob` falls back to the shallowest file with an extension
the format is known to produce. Either way the answer is stored on the build, so
publishing a PDF lands on the PDF rather than a nonexistent `index.html`.

`output-dir` is written explicitly for every target rather than relying on the CLI's
default, because the artifact job strips exactly that prefix off the returned zip.

**Formats are not gated by subscription.** The plan suggested gating non-html formats on
`subscribed?`; that is a monetization decision that is still open, so what shipped is a
cost bound (`target_quota`) rather than a paywall. Adding a gate later is one ability rule.

### PR 5 — Retire the quick build — **not started, the only remaining work**

Deliberately last: only safe once projects actually have successful html builds to point
at, because it removes the fallback. Right now the dashboard still links `projects#share`
as "Quick preview", and `projects#source` still embeds it in an iframe for visitors
deciding whether to copy a project — that second use is the one that needs a real
replacement, since it serves people who do not own the project.

Retiring it also removes the older, unpublished instance of the origin problem described
below, since `projects#share` is the other place user HTML is served anonymously.

| Artifact | Last consumer | Disposition |
|---|---|---|
| `projects.html_source` | `projects#share` | Drop after share redirects to the published target. |
| `SetHtmlSourceJob` | editor Save with `enqueue_html_source_job` | Delete; also remove the flag from `editor.jsx`. |
| `Project::ENQUEUE_SOURCE_PLACEHOLDER` | `enqueue_html_source_job` | Delete with the job. |
| `projects#preview` | `/tryit` | **Keep** — anonymous try-it needs a preview with no project row. |
| `preview_build` credentials | preview + `SetHtmlSourceJob` | **Keep** — still used by try-it. |

---

## Traps

Still live — things future work can break:

- **In-flight callback URLs.** `FullBuildJob` bakes an absolute `callback_url` into each
  submission, so a build submitted before a deploy calls back *after* it. `full_callback` is
  the one route that cannot move without dropping builds on the floor.
- **`mark!` must not be bypassed.** Every status transition goes through `Build#mark!`,
  which is what keeps the denormalized pointers in step and broadcasts the row. The value
  evaporates the first time someone adds a transition with a bare `update_column`.
- **`targets/_target.html.erb` has no session.** It is re-rendered by a background job
  during a broadcast, so it must never call `can?`, `current_user`, or a `_url` helper
  (no request means no host). Authorization lives on the actions; the copyable absolute
  URL lives in the drawer, which is always request-scoped.
- **`Target` has a two-column `default_scope`,** so `Target.group(...)` raises in Postgres
  ("must appear in the GROUP BY clause"). Use `Target.reorder(nil).group(...)`.
- **Enum values are load-bearing.** `output_format` must only ever contain formats
  PreTeXt's `project.ptx` schema accepts; a test enforces this. `scorm` is not one — it is
  html plus `compression`.

Already handled, recorded because the reasoning is not obvious from the diff:

- **Migration ordering.** `CreateTargets` backfills from `builds.project_id` and sets
  `target_id` NOT NULL in the same migration — see *Deploying* above.
- **Fixture cascade.** `fixtures :all` loads everything for every test, so the NOT NULL
  `target_id` needed `test/fixtures/builds.yml` and a new `targets.yml` updated in the
  same commit. Build fixtures carry explicit `created_at` because `latest_build` ordering
  depends on it.

---

## Open security decision: user content on the primary origin

Published output is served from `pretext.plus` itself and is anonymously reachable by
design. The question is whether an author can get JavaScript into it. They can.

### "PreTeXt transforms the XML, so the output is safe" — it isn't

PreTeXt is a document compiler, not a sanitizer, and embedding author JavaScript is a
documented feature, because interactive mathematics figures (JSXGraph, D3, GeoGebra)
require it. From PreTeXt's own sample article,
[Interactive Elements, Authored in Javascript](https://pretextbook.org/examples/sample-article/html/section-interactive-authored.html):

> "add `<script>` elements within an interactive that contain properly escaped JS code.
> These elements will be placed at the end of the document."

`<interactive>` also takes an `@source` attribute pointing at a JavaScript file, and asset
uploads have no content-type restriction — `:file` passes straight through in
`ProjectsController#project_params`.

Nothing in the app sanitizes `pretext_source`. The only `sanitize` calls in `app/` are on
admin-authored announcement markdown.

### What an attacker gets

Registration is open, so the chain is: sign up → author a document containing a
`<script>` → publish → share the link. Any **signed-in** PreTeXt.Plus user who opens it
runs that script on our origin.

Already mitigated by the current cookie settings:

| Attack | Status |
|---|---|
| Stealing the session cookie | Blocked — `httponly` |
| Cross-site CSRF | Blocked — `samesite=lax` |
| Credentialed **same-origin** `fetch` | **Not blocked** |

That last row is the exposure. A script on a published page can read the visitor's
`/projects.json`, fetch a page to scrape the CSRF token out of it, and then POST — delete
their projects, change their account email. Data theft and account takeover against anyone
who clicks a shared link, in a community whose whole habit is sharing document links.

The app sets no CSP at all: `config/initializers/content_security_policy.rb` is entirely
commented out.

### Not introduced by this work

`projects#share` is already `allow_unauthenticated_access` and renders `html_source`
inline to anyone, so the vector exists on `main` today. PR 3 widens it — full PreTeXt
builds with complete interactive support, at permanent shareable URLs — rather than
creating it. This is a roadmap item, not a release blocker.

### Options

| Option | Cost | Leaves open |
|---|---|---|
| **Separate registrable domain** (`pretextusercontent.com`), as GitHub does | DNS, cert, proxy config | Nothing |
| **Subdomain** (`content.pretext.plus`) | DNS, cert, a host constraint on `PublishedController` | Same *site*, so cookies still attach on requests to the parent; and a subdomain can shadow a parent-domain cookie |
| CSP `sandbox` | One header | **Not viable** — forces an opaque origin, so PreTeXt's `localStorage` use (Runestone progress, knowl state) starts throwing |

A subdomain is probably sufficient and much cheaper than a separate domain. There is no
`session_store` initializer, so Rails defaults to a **host-only** session cookie: from
`content.pretext.plus`, a `fetch` to `pretext.plus` becomes cross-origin, we send no CORS
headers, so the response is unreadable and the CSRF token cannot be stolen.

To close the cookie-shadowing caveat, rename the session cookie with the `__Host-` prefix.
`__Host-` cookies require `Secure` and `Path=/` and forbid a `Domain` attribute, so a
subdomain cannot overwrite them.

### To decide

1. Subdomain or separate domain?
2. Whether existing `/o/...` links must keep working after the move (they would need a
   redirect from the old origin, which reintroduces nothing — the redirect target is what
   matters).
3. Whether `projects#share` moves too, or is simply retired with PR 5, which removes the
   older instance of the same problem.

The Rails side is small — a host constraint on `PublishedController` plus URL helper
changes. DNS, TLS and Kamal/proxy config are not.

---

## Decisions

| Question | Blocks | Answer |
|---|---|---|
| Can two targets share a format? | PR 1 | **Yes** — consistent with how the CLI uses `project.ptx`. `name` is the unique key, not `output_format`. |
| Does a published output follow the latest good build, or pin to a chosen one? | PR 3 | Follow the latest. `current_build_id` is already a pointer, so pinning is a later feature that writes to it manually rather than a schema change. |
| Does publishing cost a subscription? | PR 3 | **Still open.** Shipped free and uncapped. Suggest no, but cap published targets for free accounts. |
| Are non-html formats a paid feature? | PR 4 | **Still open.** Shipped free, bounded only by `target_quota`. |
| What bounds build minutes? | PR 4 | **Answered:** builds are open to every owner, bounded by a 20/hour rate limit, `MAX_CONCURRENT_BUILDS = 3` in flight per user, and `User#target_quota`. |
| Should published output move to its own origin? | — | **Open, and the most consequential.** PreTeXt embeds author JavaScript by design, so published output can run scripts on our origin. See [Open security decision](#open-security-decision-user-content-on-the-primary-origin). |
