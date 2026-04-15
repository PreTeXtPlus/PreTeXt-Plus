# PreTeXt.Plus

Ruby on Rails application for the main [PreTeXt.Plus](https://pretext.plus) service.

## Development

Open in a codespace, run `bin/dev`. Set port `3000` to `public` then preview the app.

### Stripe CLI

```
stripe listen --forward-to 0.0.0.0:3000/pay/stripe/webhooks
```

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

