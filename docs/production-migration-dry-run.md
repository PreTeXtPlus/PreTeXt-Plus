# Dry-running migrations against a copy of production

How to test a branch's migrations on real data, using a copy of the production database
restored into the devcontainer. The procedure below was written for the content-model
migrations (`20261022120000`–`20261022120200`), but every step except 5 and 6 applies to
any migration.

The copy goes into its own database, `pretext_plus_prodcopy`, so the development database
is never touched. A pristine copy is also kept so the migrations can be rerun as many
times as needed.

**The dump holds user data.** Keep it outside the repo and delete it when you're done
(step 7).

## 1. Take the dump (on your laptop, not in the Codespace)

1. Find production's Postgres version and connection string. In the DigitalOcean control
   panel, go to **Databases → your cluster → Connection Details** and pick the **Public
   network** connection string. Under **Settings → Trusted Sources**, add your laptop's
   current IP if it isn't listed (remove it again afterward).
2. Check the server version, because your `pg_dump` must be the same major version or newer:
   ```bash
   psql "<CONNECTION_STRING>" -c "show server_version"
   pg_dump --version
   ```
3. Dump only the primary database in custom format. This is the one `DATABASE_URL` points
   at, not the cache, queue or cable databases.
   ```bash
   pg_dump "<CONNECTION_STRING>" \
     --format=custom --no-owner --no-privileges \
     --file=pretext_plus_prod_$(date +%F).dump
   ```
   **Keep all the tables.** `ProjectAndResetDocsForContentFields` reads `y_documents` and
   `y_document_updates`, and `SplitDivisionMetadataOutOfSources` reads `projects`. If you'd
   rather not copy billing data, you can add `--exclude-table-data='pay_*'`. None of the
   content-model migrations touch those tables.

## 2. Put the dump in the container, outside the repo

Create a folder outside the working tree:

```bash
mkdir -p ~/prod-dump && chmod 700 ~/prod-dump
```

Then use either method:

- **From your laptop:** `gh codespace cp ./pretext_plus_prod_YYYY-MM-DD.dump 'remote:~/prod-dump/'`
  (add `-c <codespace-name>` if you have more than one Codespace).
- **In VS Code:** drag the file into the Explorer, then `mv` it into `~/prod-dump/`.

## 3. Restore it into a separate database

In the devcontainer terminal (the devcontainer's Postgres is at host `postgres`, with user and
password both `postgres`):

```bash
export PGHOST=postgres PGUSER=postgres PGPASSWORD=postgres
createdb pretext_plus_prodcopy
pg_restore --no-owner --no-privileges --dbname=pretext_plus_prodcopy ~/prod-dump/*.dump
```

- The local server is Postgres 16.1. If production is 17, `pg_restore` may print errors
  like `unrecognized configuration parameter "transaction_timeout"`. Those are harmless.
  Errors about tables or constraints are not, so stop and look into them.
- Next, save a pristine copy to reset to between runs. This is fast because it copies
  from a template:
  ```bash
  createdb -T pretext_plus_prodcopy pretext_plus_prodcopy_pristine
  ```

## 4. Point Rails at the copy and check its starting state

```bash
cd /workspaces/PreTeXt-Plus
export DATABASE_URL=postgres://postgres:postgres@postgres/pretext_plus_prodcopy
npm run build:assembler          # rebuilds lib/assembler/split-divisions.mjs, which the split migration runs
bin/rails db:migrate:status | tail -8
```

**Expected:** only the branch's new migrations show as `down`. If any older migration is
also `down`, production is behind `main`. Resolve that before reading anything into the
results.

Take some "before" counts to compare against later:

```bash
psql pretext_plus_prodcopy -c "
  select (select count(*) from divisions) divisions, (select count(*) from snippets) snippets,
         (select count(*) from assets) assets, (select count(*) from y_documents) ydocs,
         (select count(*) from active_storage_attachments where record_type='Asset') asset_attachments;"
```

## 5. Run the migrations one at a time, logging each

Running them one at a time tells you which step fails or is slow:

```bash
mkdir -p ~/prod-dump/logs
for v in 20261022120000 20261022120100 20261022120200; do
  ( time bin/rails db:migrate:up VERSION=$v ) 2>&1 | tee ~/prod-dump/logs/$v.log || break
done
```

What to watch for:

- **`20261022120000` CreateContents:** it can abort with
  `contents need unique, present refs per project; fix these first: …`. That means
  production has duplicate or null refs that must be fixed before the real run. Save the
  list it prints.
- **`20261022120100` ProjectAndResetDocsForContentFields:** lines saying
  `could not project <key> before resetting it` mean a collaborative document whose unsaved
  edits would be lost in production.
- **`20261022120200` SplitDivisionMetadataOutOfSources:** it prints
  `N divisions split, M of them carrying their own element`, followed by one line per
  division the split had to decide something about, then
  `K divisions did not split losslessly: <id>, …` if any did not. A
  `NodeScript::Error` or timeout means the bundle failed on some real source. The
  per-division lines worth a second look:

  - `source named xml:id "…", kept ref "…"` -- the division's `xml:id` changes to its ref
    in the assembled document.
  - `a root's element is a root element; its leading <section> is body` -- a root whose
    source was a bare fragment beginning with a `<section>` (the shape a "Try it" project
    starts in). It is typed by the project and that section is its first child, exactly
    as the editor showed it.
  - `<section> is not the whole source; kept all of it as body` -- a division holding
    several top-level elements. It keeps them all, but under one element where the old
    assembly spliced them in as siblings.
  - `<section> is not well formed inside; closed it at its last </section>` -- an unclosed
    `<p>`, a bare `<br>`, a stray `</p>` in the body threw the tag count off, so the
    element was closed at the last `</section>` in the source. The body is kept as
    written. (`<section> is never closed` is the case with no such close tag at all: the
    whole rest is body.)
  - `source opens with the division's own element (…) but was not split around it` --
    the first element carries the division's ref but has content after its close; the
    division is kept whole as body, so assembly wraps that element in a second copy of
    itself. Worth fixing by hand afterwards.
  - `dropped label "…"` and `dropped the * of \section*` are the split's design.

  The lossless check compares the element rebuilt from a division's new fields around its
  new body with the old source, blind only to what the split is defined to change (blank
  lines at the seams, a `label`, attribute order). A division listed as not lossless has
  something in its source with no field to go to -- a `\section*` star, a `\label` inside
  a title argument, an attribute on a `<title>`, a frontmatter line that isn't
  `key: value` -- or is one of the two whole-as-body cases above. The old source stays in
  `legacy_divisions` (step 6), so each can be compared afterwards.

## 6. Check the results

```bash
psql pretext_plus_prodcopy <<'SQL'
-- row counts should equal the "before" numbers
select kind, count(*) from contents group by kind order by kind;      -- 0 division, 1 snippet, 2 file asset, 3 authored asset
select count(*) as ydocs_left from y_documents;                       -- expect 0
select count(*) from active_storage_attachments where record_type='Content' and name='files';  -- = asset_attachments
-- spot-check the split
select division_type, count(*) from contents where kind=0 group by 1 order by 2 desc;
select count(*) as untitled_nonroot from contents where kind=0 and not is_root and title is null;
SQL
```

To spot-check a few sources before and after the split (the old tables still exist as
`legacy_*`):

```sql
select c.ref, c.division_type, c.title, left(l.source, 200) as before, left(c.source, 200) as after
from contents c join legacy_divisions l using (id) where c.kind = 0 order by random() limit 5;
```

**Optional, in the browser:** run `bin/dev` with `DATABASE_URL` still exported, sign in with
your production password and open some real projects. Images and other uploaded files won't
load, because development uses local storage instead of Spaces. Avoid anything that sends
email or touches billing.

## 7. Reset and rerun, then clean up

- **To rerun** (for example after changing a migration):
  ```bash
  dropdb pretext_plus_prodcopy && createdb -T pretext_plus_prodcopy_pristine pretext_plus_prodcopy
  ```
- **After each run,** check `git diff db/schema.rb`. Running migrations in development
  rewrites that file, and any change there means production's schema has drifted from
  `main`. Then discard it with `git checkout db/schema.rb`.
- **When you're finished:**
  ```bash
  unset DATABASE_URL
  dropdb pretext_plus_prodcopy; dropdb pretext_plus_prodcopy_pristine
  rm -rf ~/prod-dump
  ```
  Also delete the dump on your laptop and remove your IP from DigitalOcean's Trusted
  Sources.

The step 5 logs and the step 6 query output contain counts, warnings and refs but no user
content, so they are safe to share when asking for help reading them.
