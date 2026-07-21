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

