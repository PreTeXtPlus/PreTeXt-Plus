# PreTeXt.Plus – Copilot Instructions

## What this app does

PreTeXt.Plus is a Rails 8 web app for authoring and sharing mathematical textbooks in the [PreTeXt](https://pretextbook.org/) markup language (XML-based). Users create projects, write PreTeXt content in an in-browser editor, and get live HTML compilation via an external build server. Access is invitation-gated, with Stripe-based subscription tiers.

---

## Development

```bash
bin/dev          # Start all dev processes (Rails + Tailwind + esbuild watch via Foreman)
bin/setup        # Install dependencies, prepare DB, start server
bin/setup --reset            # Reset DB before setup
bin/setup --skip-server      # Setup without starting server
```

If running in a GitHub Codespace, set port 3000 to **Public** then preview the app.

---

## Testing

```bash
bin/rails test                                   # Full suite (Minitest, parallelized)
bin/rails test test/models/user_test.rb          # Single file
bin/rails test test/models/user_test.rb:27       # Single test by line number
bin/rails test:system                            # Browser-based system tests (requires Chrome)
```

### Test helpers

- **`stub_build_server { ... }`** — stubs the external build server (`Net::HTTP.post_form`). Available in all test types via `BuildServerHelper`. Wrap any test that saves a project.
- **`sign_in_as(user)`** / **`sign_out`** — creates a session cookie for a fixture user. Available in integration tests via `SessionTestHelper`.

---

## Linting & Security

```bash
bin/rubocop        # RuboCop (rubocop-rails-omakase style)
bin/brakeman       # Security vulnerability scan
bin/bundler-audit  # Gem dependency vulnerability check
```

---

## Architecture

**Stack:** Rails 8.1 · PostgreSQL · React 19 + Stimulus + Turbo · Tailwind CSS 4 · ESBuild · Propshaft

**Frontend entry:** `app/javascript/application.js` loads Stimulus. The editor is a Stimulus controller (`controllers/editor_controller.js`) that lazy-imports a React component (`controllers/react/editor.jsx`), which wraps `@pretextbook/web-editor`. The Stimulus controller handles auto-save (10s intervals, only when dirty) and triggers preview rebuilds by posting to the build server via iframe.

**Background jobs:** Solid Queue (production only, or in-process via `SOLID_QUEUE_IN_PUMA=1`). Solid Cache and Solid Cable also run on separate DB roles.

**Deployment:** Docker via Kamal (`config/deploy.yml`).

---

## Key Models

| Model | Notes |
|---|---|
| `User` | `subscription` enum (`beta:0`, `sustaining:1`); `admin` boolean; project quota enforced at controller layer |
| `Project` | `source_format` enum (`pretext:0`, `latex:1`, `pmd:2`), `document_type` enum (`article:0`, `book:1`, `slideshow:2`), both with `suffix: true`; `html_source` set via `before_update` by calling the external build server; default scope: `order(updated_at: :desc)` |
| `SourceElement` | Hierarchical document structure via adjacency list (`parent_id` + `position`). `element_type` (section, chapter, docinfo, etc.), `title`, `source`, `pretext_source`. Container vs. content determined by whether children exist. `to_xml` recursively assembles PreTeXt XML. |
| `Session` | Tracks `ip_address`, `user_agent`; stored in signed cookie |
| `Invitation` | Has `owner_user` and optional `recipient_user`; `code` used for redemption link |
| `Request` | Users requesting early access |
| `Current` | `ActiveSupport::CurrentAttributes` — holds `session`, delegates `user` |

All models use **UUID primary keys** (`gen_random_uuid()`).

---

## Authentication & Authorization

Authentication is **custom session-based** (no Devise). Key points:

- `app/controllers/concerns/authentication.rb` provides `allow_unauthenticated_access`, `require_unauthenticated_access`, and `authenticated?`
- `Current.session` / `Current.user` are available throughout a request
- Passwords use `has_secure_password` (bcrypt); login via `User.authenticate_by`
- Sessions stored as UUID in a signed, `httponly`, `same_site: :lax` cookie

Authorization is inline (no Pundit/CanCan):
- `require_ownership` before_action guards project routes
- `limit_projects` before_action enforces per-tier quotas (admin: 10k, sustaining: 100, beta: 10, unverified: 0)
- Admin checks are manual boolean checks in controllers

---

## External Services

| Service | Env vars | Purpose |
|---|---|---|
| Build server | `BUILD_HOST`, `BUILD_TOKEN` | Compiles PreTeXt XML → HTML on project save |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_SUSTAINING_PRICE`, `STRIPE_WEBHOOK_SECRET` | Subscriptions & billing portal |
| Resend | `RESEND_API_KEY` | Transactional email (invitations, password reset) |

---

## Conventions

- **Email normalization:** `normalizes :email, with: ->(e) { e.strip.downcase }` — always stored lowercase/stripped
- **Rate limiting:** Native Rails rate limiting on `SessionsController#create` and `PasswordsController#create` (10 requests / 3 min)
- **Mailers use `deliver_later`** and go through the Resend API (configured in `config/initializers/mailer.rb`)
- **Project build** happens in `Project#before_update` — saving a project triggers an HTTP call to the build server; uses `assemble_source` from source_elements when available, falls back to legacy `source` column; always wrap controller tests that save projects with `stub_build_server`
- **Source elements** are organized in an adjacency list (`parent_id` + `position`). Whether an element is a container or content is determined dynamically: elements with children are containers (not editable), elements without children are content (editable). Use `Project#scaffold_elements!` for new projects and `rake source_elements:migrate_legacy` for existing data.
- **Sharing:** Projects have a public `/projects/:id/share` route (no auth required) and a copy-to-account feature gated to sustaining/admin users
- **Strong parameters:** Use `params.expect(...)` (Rails 8 style) instead of `params.require(...).permit(...)`
- **Enum safety:** Enum fields in `safe_project_params` are sanitized with `presence_in(...)` to return `nil` instead of raising `ArgumentError` on unknown values
