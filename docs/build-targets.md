# Build targets

Plan of record for turning the single hardcoded `web` build into a set of user-managed
output targets (html, pdf, epub, braille, scorm, and custom variants).

Companion design docs (clickable mockups of the three screens):

- Interface proposal — <https://claude.ai/code/artifact/89a1520a-a005-49c8-9863-f383c7112358>
- Implementation plan — <https://claude.ai/code/artifact/846ac33e-f8dd-445a-bc00-2d7f1872ba6f>

---

## The modeling change

`Build` currently does two jobs: it is the record of an attempt *and* the thing a reader
visits. That works with exactly one output. With several, "which build is my PDF?" has no
answer the interface can give.

So a **target** becomes a first-class, persistent object — name, format, published flag,
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
| `builds.target_id` | uuid, not null, fk | A build is an attempt at a target. `project_id` stays as a denormalization so existing nested routes keep working. |
| `projects.source_updated_at` | datetime, not null | When the author last changed source, docinfo or assets. |

Both build pointers deliberately have **no** foreign key constraint. One would be circular
(`targets.current_build_id -> builds.id -> targets.id`) and would fight
`dependent: :destroy`. `Build#sync_target` keeps them honest instead, recomputing both
whenever a build is created, transitions, or is destroyed.

---

## The four PRs

Each is independently deployable. The first three need nothing from
`pretext-plus-build-full`, so the whole interface can ship before any new format exists.

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

> ### ⚠ Unresolved before publishing is promoted: user content on the primary origin
>
> Published output is user-authored HTML+JS served from `pretext.plus` itself, now
> anonymously reachable by design. Any script in a published document runs with the
> application's origin: it can make credentialed same-origin requests as a logged-in
> visitor, read a CSRF token out of a fetched page, and phish from a trusted URL. Session
> cookies are `httponly; samesite=lax`, which blocks cookie theft and cross-site CSRF but
> not same-origin fetches from a page a victim actually visits. The app currently sets no
> CSP at all (`config/initializers/content_security_policy.rb` is entirely commented out).
>
> This is not new — `projects#share` and `/builds/:id/files/...` already served user HTML —
> but publishing turns it into a promoted, shareable, anonymous surface, and the URL shape
> is being fixed now, which is the expensive thing to change later.
>
> **Recommended:** serve published output from a separate origin, the way GitHub uses
> `githubusercontent.com`. A CSP `sandbox` directive is the cheap alternative and would
> neutralize same-origin access, but sandboxing forces an opaque origin, so any PreTeXt
> feature touching `localStorage` (Runestone progress, knowl state) would start throwing.
> That needs testing against a real build before it could ship, so nothing was applied.

### PR 4 — More formats  *(gated on build-server support)*

- `ProjectArchiveBuilder::TARGET` disappears; `project.ptx` lists every target.
- `FullBuildJob` submits `build.target.name`.
- `FullBuildArtifactJob` strips `"#{build.target.name}/"` instead of the constant.
- `Target#entry_path` — a PDF build produces one file, not a site, and
  `BuildFilesController` currently defaults a blank path to `index.html`.
- "+ Add output" UI; gate non-html formats at the ability layer, not just the view.
- A target quota on `User` mirroring `project_quota`. Build minutes are the real cost centre
  and nothing bounds them today, because only admins could build.

### PR 5 — Retire the quick build  *(optional, last)*

Separable, and deliberately after PR 3 — only safe once every project has a successful html
build.

| Artifact | Last consumer | Disposition |
|---|---|---|
| `projects.html_source` | `projects#share` | Drop after share redirects to the published target. |
| `SetHtmlSourceJob` | editor Save with `enqueue_html_source_job` | Delete; also remove the flag from `editor.jsx`. |
| `Project::ENQUEUE_SOURCE_PLACEHOLDER` | `enqueue_html_source_job` | Delete with the job. |
| `projects#preview` | `/tryit` | **Keep** — anonymous try-it needs a preview with no project row. |
| `preview_build` credentials | preview + `SetHtmlSourceJob` | **Keep** — still used by try-it. |

---

## Traps

- **In-flight callback URLs.** `FullBuildJob` bakes an absolute `callback_url` into each
  submission, so a build submitted before a deploy calls back *after* it. `full_callback` is
  the one route that cannot move without dropping builds on the floor.
- **`mark!` must not be bypassed.** The value evaporates the first time someone adds a twelfth
  transition with `update_column`.
- **Migration ordering.** `CreateTargets` backfills from `builds.project_id` and sets
  `target_id` NOT NULL in the same migration. Check `Build.where.missing(:project).count` in
  production first.
- **Fixture cascade.** `fixtures :all` loads everything for every test, so a NOT NULL
  `target_id` breaks fixtures in suites unrelated to this work. Update them in the same commit
  as the migration.

---

## Decisions

| Question | Blocks | Answer |
|---|---|---|
| Can two targets share a format? | PR 1 | **Yes** — consistent with how the CLI uses `project.ptx`. `name` is the unique key, not `output_format`. |
| Does a published output follow the latest good build, or pin to a chosen one? | PR 3 | Follow the latest. `current_build_id` is already a pointer, so pinning is a later feature that writes to it manually rather than a schema change. |
| Does publishing cost a subscription? | PR 3 | Open. Suggest no, but cap the number of published targets for free accounts. |
| What bounds build minutes? | PR 4 | Open. Suggest a target quota plus a rate limit on `builds#create`. |
