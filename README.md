# PreTeXt.Plus

Ruby on Rails application for the main [PreTeXt.Plus](https://pretext.plus) service.

## Development

Open in a codespace, run `bin/dev`. Set port `3000` to `public` then preview the app.

### Stripe CLI

```
stripe listen --forward-to 0.0.0.0:3000/pay/stripe/webhooks
```

### Database & migrations

```bash
bin/rails db:migrate          # Apply pending migrations
bin/rails db:migrate:status   # See which migrations have run
bin/rails db:reset            # Drop, recreate from schema.rb, and re-seed (wipes dev data)
```

`db:reset` rebuilds the database by loading `db/schema.rb` rather than replaying every
migration, so it's the quickest way to recover a broken or out-of-sync development
database — and much faster than rebuilding the whole Codespace. It re-runs `db/seeds.rb`,
so you get the dev admin user (`admin@example.com` / `password123`) back automatically.

**Don't duplicate or rename migrations.** Once a migration has been committed and run
anywhere (your machine, a teammate's, CI, or production), its timestamp is permanent:
the database records that exact version in `schema_migrations`. Renaming the file or
changing its timestamp leaves the old version orphaned (`db:migrate:status` shows it as
`********** NO FILE **********`) and makes the new one look "pending," so the next
`db:migrate` re-runs the change and crashes on an already-applied column. To change a
migration that has already run, **add a new migration** instead.

When switching branches, run `bin/rails db:migrate:status` to see if the branches carry
different migrations. If a branch's migrations left your DB in a mixed state, roll the
specific one back with `bin/rails db:rollback` before switching, or just run
`bin/rails db:reset` on the new branch to start clean from its `schema.rb`.

### Keeping up with PreTeXt

```bash
bin/rails pretext:journals    # Refresh config/pretext_journals.yml
```

The journal styles offered in build settings are PreTeXt's, not ours: PreTeXt keeps
`journals/journals.xml` as its source of truth and resolves a publication file's
`<journal name="..."/>` against it. This task fetches that file — from the same PreTeXt
the app's XSL is pinned to, read out of
`node_modules/@pretextbook/pretext-html/assets/upstream.json` — and rewrites
`config/pretext_journals.yml`, which `Publication::Catalog` loads.

**Run it after bumping `@pretextbook/pretext-html`, and commit the result.** It is
deliberately not part of `npm run build`, which runs in watch mode all through
development; the picker should not depend on the network being up.

The picker shows the publisher-wide styles (`ams`, `elsevier`, …) above the individual
journals. PreTeXt does not record that distinction — its own list is flat — so the task
keeps it in a `publisher_wide` list, files anything unrecognised as an individual journal,
and says so when a newly added journal looks like it belongs in the other group.

## Testing

The test suite uses Rails' built-in Minitest framework.

```bash
bin/rails test                                    # Run the full suite
bin/rails test test/models/user_test.rb           # Run a single file
bin/rails test test/models/user_test.rb:27        # Run a single test by line number
bin/rails test:system                             # Run system tests (requires Chrome)
```

### Test structure

| Directory | Contents |
|---|---|
| `test/models/` | Unit tests for model validations, callbacks, and business logic |
| `test/controllers/` | Integration tests for HTTP request/response cycles |
| `test/mailers/` | Tests for email content and recipients |
| `test/system/` | Browser-based end-to-end tests (Capybara) |
| `test/fixtures/` | Seed data loaded before each test |

### Helpers

- **`stub_build_server`** — stubs the external PreTeXt build server so tests run without `BUILD_HOST`/`BUILD_TOKEN` set. Available in all test types via `BuildServerHelper`.
- **`sign_in_as(user)`** — signs in a fixture user by creating a session cookie. Available in integration tests via `SessionTestHelper`.

### CI

Tests run automatically on every pull request and push to `main` via GitHub Actions (`.github/workflows/ci.yml`). The workflow runs linting, security scans, and the full test suite against a PostgreSQL service container.

