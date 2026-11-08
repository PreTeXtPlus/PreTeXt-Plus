# Repairing a stuck collaborative project

A runbook for the case where a project's rows have stopped following its
collaborative document. It happened twice in November 2026 (Nov 4–5 and
Nov 6–7, and once on Oct 2), each time because one malformed entry in the
Yjs document made the projection fail. The code now survives that
(`ProjectDocProjection`), tells people about it (editor banner, project page,
build drawer, a daily Honeybadger summary) and refuses or repairs the writes
that caused it (the editor's `CollabBridge`). What is left for a person is
purging an entry that is already in a document, which only a reset can do.

## How the pieces fit

- **The document is the truth while anyone is editing.** Every keystroke in a
  collaborative session goes into the Yjs document on the server. Nothing is
  lost while the rows lag; what lags is the *saved copy*: builds, copies,
  downloads, the project page.
- **The projection writes the document into the rows** (`ProjectDocProjection`),
  every minute for active documents, before every build, and on
  "Manage project". A record it cannot write (a ref with a space, a missing
  ref, a duplicate) is skipped and listed in `projects.projection_issues`;
  everything else still lands.
- **yrby can read a document but not write one.** A bad entry cannot be
  removed in place. The only way to purge it is to drop the document and let
  the next tab reseed it from the rows, which is safe exactly when the rows
  hold everything in the document worth keeping. That is what `collab:repair`
  checks and does.

## When to look

Any of these means a project may be stuck:

- Honeybadger: `Collab::ProjectionIssues` (one per project, when its issues
  go from none to some) or the daily `Collab::ProjectionHealth` summary.
- An author reports the amber banner in the editor, or the project page says
  "N records in the editor can't be saved to this project".
- A build fails at assembly with "ref is invalid" or "ref can't be blank".
- `Collab::MalformedRecord` or `Collab::DuplicateRef` incidents, which mean an
  editor *tried* to write a bad record. These are refused or repaired in the
  editor, so no action is needed, but the detail names the caller.

## Connecting to production

Production runs on a DigitalOcean droplet via Hatchbox. Rails commands run
from the deploy user's current release:

```sh
ssh deploy@<droplet>
cd ~/PreTeXtPlus/current
RAILS_ENV=production bundle exec rails collab:scan
```

Everything below is written as `bin/rails …`; in production prefix it with
`RAILS_ENV=production bundle exec`.

## Step 1: scan

```sh
bin/rails collab:scan
```

Lists every collaborative project whose last projection skipped a record, or
whose rows differ from its document right now. Prints `[]` when everything is
clean. A line looks like:

```
8c209f50-… "Calculus Notes": 2 issue(s), 5 differing row(s)
```

Differing rows alone, with no issues, usually just mean the document was
edited in the last minute and the projection has not run yet. Run the scan
again; if the same project keeps differing with no issues, the projection job
itself may be failing, and Honeybadger will have the exception.

## Step 2: dry run

```sh
bin/rails "collab:repair[<project_id>]"
```

Changes nothing. It prints four things; read all of them:

1. **Issues**: the records the projection skips, with the reason
   (`ref "sec-chapter 1 " is invalid`, `ref is already used by division …`,
   `ref is missing`).
2. **Rows that differ from the document**: field by field, row value against
   document value. After a repair these must be empty; the repair checks and
   refuses otherwise.
3. **Entries the reset will drop**, with their full content including source.
   This is the only copy of that content once the document is reset. If any
   of it matters (an author typed a section under a bad id), copy it out of
   the report now and hand it back to them, or paste it into the project
   after the repair.
4. **Users who will be disconnected**: the owner and every accepted
   collaborator. Their open tabs lose the session and have to reload. Nothing
   they typed is lost: it is already in the document, and the projection
   writes it to the rows before the reset.

A dry run against a healthy project prints no issues, no differing rows and
nothing to drop. That is also a good thing to confirm once after a deploy.

## Step 3: repair

```sh
APPLY=1 bin/rails "collab:repair[<project_id>]"
```

In order, it: disconnects the users; projects; checks every surviving
record's row matches the document; resets the document and clears the
recorded issues; disconnects again in case anyone rejoined. The first tab to
reopen the project seeds a fresh document from the rows.

If the check in the middle fails it prints
`rows still differ from the document after projecting; not resetting` and
stops with the document intact. That means a record the projection wrote was
refused for a reason the report could not predict (the message names the
field). Fix that record's row or the document entry first; do not force it.

Tell the author what happened. The dropped entries are gone from the editor
after the reset; if one was theirs, give them the content from the report.

## What not to do

- **Do not project the bad fields around a bad ref by hand.** Keeping the
  ref but writing the other fields blanked an asset's title during the first
  recovery. The projection skips the whole entry on purpose.
- **Do not reset without projecting first**, and do not reset while users
  are connected. A connected tab resyncs its copy of the old document into
  the new one. The task orders this correctly; the console procedure that
  preceded it was easy to get wrong.
- **Do not edit the `y_documents` or `y_document_updates` tables.** Reset
  through `ProjectDoc.reset!`, which the task does.

## Doing it from the console instead

If the task cannot run for some reason, the same steps in a
`rails console`:

```ruby
project = Project.find("<project_id>")
repair = ProjectDocRepair.new(project)
puts repair.render(repair.report)   # the dry run
repair.apply!                        # the repair; raises ProjectDocRepair::Abort rather than reset unsafely
```

## Afterwards

- Rebuild once and confirm the build drawer no longer shows the alert.
- `bin/rails collab:scan` should print `[]`.
- The Honeybadger fault for that project can be resolved. Faults 134787361
  and 134787338 are the two from the November incidents; resolve them once no
  new occurrences appear for a week.
