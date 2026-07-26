# Public URLs and project identifiers

Proposal for replacing the UUID in shareable URLs with a short, readable public id.

**Status: proposed, not implemented** (written 2026-07-26, against branch `builds`).

Companion to [build-targets.md](build-targets.md), which is where the `/o/…` URL shape
comes from.

---

## The problem, and why the timing matters

A published target is addressed by the project's primary key:

```
pretext.plus/o/8f14e45f-ceea-4b7e-9d1a-8a2b3c4d5e6f/website/index.html
```

Thirty-six characters of hex in a link that authors hand to students, put in a syllabus,
and read aloud in class. The target segment (`website`) is a slug derived from the
output's name and is already short and readable; only the project segment is ugly.

Two facts set the deadline:

- **`/o/…` is not deployed yet.** The URL shape is still free to change. Once one author
  has put a link in a syllabus it is not.
- **`/projects/:uuid/share` links *are* in the world**, and asset refs baked into already-built
  HTML carry the UUID too. Whatever we do, the UUID has to keep resolving forever.

## The framing

Do not touch the primary keys. A UUID is a good internal identity — foreign keys, `dom_id`,
broadcast stream names and `builds.target_id` all want it, and every table in the schema is
built on it. The problem is only that the *public* identifier and the *primary key* are the
same column.

So: **split them.** Add one short public id to `projects`, keep the UUID as a permanent
alternate lookup key. Nothing already in the world breaks, because the old identifier never
stops working — it merely stops being the one we generate.

## Recommendation

`projects.public_id`: a short, lowercase [Crockford base32](https://www.crockford.com/base32.html)
string (`0-9a-z` minus `i`, `l`, `o`, `u`), with the title slug as a decorative prefix.

```
now       pretext.plus/o/8f14e45f-ceea-4b7e-9d1a-8a2b3c4d5e6f/website/index.html
plain     pretext.plus/o/k3m9xq2p/website/index.html
prefixed  pretext.plus/o/linear-algebra-k3m9xq/website/index.html  <- recommended
```

**Look up on the trailing code only; treat the prefix as decorative.** This is the Notion
trick, and it is what makes the readable form safe: retitling a project then cannot break a
link, because an old prefix still resolves. A canonical 302 to the current spelling is
optional on top.

| Option | Cost | Why not |
|---|---|---|
| Random code (`k3m9xq2p`) | one column | Nothing wrong with it — just meaningless to a reader. The fallback if the prefix proves fussy |
| **Title slug + code** | + slug generation, optional canonical redirect | — |
| Handle + slug (`/o/oscarlevin/linear-algebra/`) | `users.handle`, reserved-word list, squatting policy, rename policy — and it publishes author identity by default | A real feature (author pages), not a URL tweak. Sign-up is email-only, so there is no handle to draw on |
| Encode the UUID (hashids, base62) | no column | 128 bits is still 22 characters. Truncating is not safe |

### Why lowercase, and why that alphabet

Not cosmetic, in both cases:

- **Lowercase, hyphen-safe, no underscores** so the code can become a DNS label. If the
  [open security decision](build-targets.md#open-security-decision-user-content-on-the-primary-origin)
  resolves toward moving published output to its own host, `k3m9xq2p.pretextusercontent.com`
  gives per-project origin isolation for free. Base62 or underscores would foreclose that.
- **No `i`, `l`, `o`, `u`** because these URLs get read aloud and typed off a projected
  slide, where `1`/`l` and `0`/`O` are the same character. (Crockford drops `u` as well,
  to keep accidental words out.)

Six characters is 30 bits (~10⁹) alongside a title prefix; eight is 40 bits if the code
stands alone.

## Sketch

```ruby
# app/models/project.rb
ALPHABET = ("0".."9").to_a + ("a".."z").to_a - %w[ i l o u ]
UUID = /\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/

# Accepts either form, permanently. UUID first: a UUID contains hyphens, so the suffix
# split below would otherwise mangle it.
def self.find_by_public_id!(param)
  param = param.to_s
  return find(param) if param.match?(UUID)
  find_by!(public_id: param.split("-").last)
end

def to_param = "#{title.parameterize.presence&.+("-")}#{public_id}"
```

`find_by_public_id!` is deliberately that name: cancancan 3.6 prefers a `find_by_<x>!`
dynamic finder (`lib/cancan/controller_resource_finder.rb`), so
`load_and_authorize_resource find_by: :public_id` picks ours up, and every controller that
loads a project inherits *both* forms with no other change.

### Where it plugs in

| Concern | Files |
|---|---|
| Column | New migration — add nullable, backfill, then unique index + `NOT NULL` |
| Model | `app/models/project.rb` — assignment on create, `to_param`, `find_by_public_id!` |
| Loaded controllers | `find_by: :public_id` on `projects_controller.rb`, `targets_controller.rb`, `builds_controller.rb` |
| Bare finds | `published_controller.rb`, `assets_controller.rb`, `admin/projects_controller.rb` |
| Editor | `app/views/projects/_form.html.erb` — `project.to_param`, so the React editor's hand-built `/projects/${projectId}` fetches match |
| Fixtures | `test/fixtures/projects.yml` — a `NOT NULL` unique column needs a value per row |

### Optional, and worth doing at the same time

`get "o/:project_id"` redirecting to the project's default published site target. Then the
*copyable* link is `pretext.plus/o/linear-algebra-k3m9xq` and the deep `/website/index.html`
path is only where the browser lands — the same trick the existing bare-target redirect
already uses, one level up.

## Traps

- **The UUID must keep resolving forever.** Asset refs inside already-built HTML and share
  links in syllabi both carry it. `find_by_public_id!` accepting both forms is not a
  migration convenience — it is permanent.
- **Collisions need a retry.** Rescue the unique-index violation and re-roll. Birthday risk
  at this scale is negligible, but "negligible" is not "handled".
- **The code is an identifier, not a capability.** An unpublished target still 404s
  regardless of who guesses the URL, so guessability carries no security weight — which is
  also why a short code is fine.
- **`to_param` changes every generated project URL at once**, including ones rendered from
  background jobs. `dom_id` and broadcast stream names use `id` and are unaffected.
- **Fixtures load for every test** (`fixtures :all`), so the `NOT NULL` column and
  `projects.yml` have to land in the same commit.

## Open questions

1. Keep the title prefix, or ship the bare code? The prefix is nicer to read and costs a
   canonical-redirect decision.
2. If a title changes, canonically redirect to the new spelling, or just keep serving the
   old one? (Both resolve; this is only about what the address bar says.)
3. Does `projects#share` start generating the new form too, or stay UUID-only until it is
   retired with PR 5?
