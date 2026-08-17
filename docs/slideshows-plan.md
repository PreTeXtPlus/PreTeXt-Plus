# Slideshows

Plan of record for first-class `<slideshow>` support.

**Status:** the preview render path landed earlier on `main` (old Part 4.1/4.2). Parts 1,
2 and 3 are **done** on this branch — a slideshow can be created, and the editor types it
correctly. Part 4.3 (the build-server fallback) and Part 5 (authoring affordances) are
open.

## Context

A slideshow is a PreTeXt document whose root element is `<slideshow>` rather than
`<article>`/`<book>`, built to a reveal.js deck (or a Beamer PDF) instead of a website.
The target catalog has restricted `revealjs`/`beamer` to slideshows since the
build-targets work, the editor knows `slideshow` as a division type, and the live preview
now renders and drives a deck properly. What is still missing is a way to *make* one.

### Decisions

1. **All three markup styles may be slideshows.** *(Revised — the previous plan restricted
   slideshows to PreTeXt-classic until someone exercised the other paths. They have now
   been exercised: both converters handle a slideshow root today, with no package changes
   needed.)* Verified against the installed `@pretextbook/latex-pretext` and
   `@pretextbook/remark-pretext`:

   | Markup | Root | Section | Slide |
   | --- | --- | --- | --- |
   | PreTeXt | `<slideshow>` | `<section>` | `<slide>` |
   | LaTeX | `\slideshow{…}` | `\section{…}` | `\begin{frame}{Title}` |
   | Markdown | `division: slideshow` frontmatter | `#` | `##` |

   Two things to carry forward. **LaTeX authors slides with Beamer's `frame` environment,
   not a `\slide` macro** — `\slide{…}` converts to a `<TODO type="unknown-macro">`, so
   Part 5's snippet must emit `\begin{frame}`. And **Markdown's heading levels shift
   meaning inside a slideshow**: `#` is a section and `##` a slide, where in an article
   they are the root and a section. A Markdown deck written with only `##` headings
   produces `<slide>` children directly under `<slideshow>` — the flat form discussed in
   Part 5, which is now reachable through an ordinary authoring path rather than
   hypothetical.

2. **The `document_type` enum keeps all three values.** *(Revised — the previous plan
   collapsed `article`/`book` into a single `document`.)* The only axis any code
   discriminates on is slideshow-vs-not, and `Target::Catalog#available_for?` asks exactly
   that question, so the collapse bought nothing and cost a data migration, a retired
   integer, fixture churn across six files, and a new normalization trap on the import
   path. Keeping `book` also keeps the Rails→editor mapping an identity function across
   all three values (Part 3.1), which is strictly simpler than mapping `document` back
   onto the literal tag `article`.

   The staleness this leaves behind — a project row saying `article` whose root element
   the author has since switched to `<book>` — already exists on `main` today and has no
   consumer: article-vs-book is read only by two admin display strings and by the
   editor's root-wrapper synthesis fallback for a project that has no wrapper yet. See
   Part 1.3 for the optional fix if it ever starts to matter.

3. **Slideshow-vs-not is fixed at creation; article-vs-book is not.** Turning a document
   into a deck means rewriting the source, invalidating targets, and re-deciding what
   every division means — not a temporary limitation. Article↔book stays freely
   switchable in the TOC exactly as it is today.

4. **The local WASM render is the primary preview path.** `@pretextbook/pretext-html`
   renders decks in-page. The lite build server remains the fallback for engines without
   WebAssembly JSPI; it takes an **optional** `target` of `html` or `revealjs` and detects
   the format from the source when it is absent.

### What already works — do not redo

- `Project` has the enum value; `Target::Catalog` restricts `revealjs`/`beamer` to it
  ([catalog.rb:96,100](../app/models/target/catalog.rb#L96)), enforced three ways
  (picker, `Target`, `Project`). See `docs/build-targets.md`.
- The editor knows `slideshow` as a `DivisionType` throughout: TOC labels, id prefix,
  `ALLOWED_CHILD_DIVISION_TYPES.slideshow = ["section"]`, root-division lookups,
  `ROOT_DIVISION_TYPES` in `sectionUtils.ts`.
- `railsDivisionToEditor` derives a PreTeXt root's type from its own tag, so a
  `<slideshow>` root already types itself correctly once one exists.
- **The whole preview render path (old Part 4.1/4.2) is done.** `@pretextbook/pretext-html`
  is on `^0.12.0` and committed. `wasmPreview.renderPreviewHtml` returns `target`;
  `LivePreview` tracks `renderTarget`, defaults a deck to `revealView: "scroll"`, and
  offers Scroll/Slides and zoom controls gated on `renderTarget === "slides"`, switching
  views by re-applying `applyRevealView` to the HTML in hand rather than talking to the
  live deck.
- The Insert menu now has real placement machinery — `editorConfigs/insertContext.ts`
  gates each snippet on whether the cursor is inside a `<p>`. Part 5 builds on this
  rather than inventing anything.

---

## Part 1 — Fix the slideshow axis at creation ✅ done

No migration. No schema change. The enum at
[project.rb:44](../app/models/project.rb#L44) stays exactly as it is:

```ruby
enum :document_type, { article: 0, book: 1, slideshow: 2 }, default: :article, suffix: true, validate: true
```

### 1.1 Permit `document_type` on create only

[projects_controller.rb:268](../app/controllers/projects_controller.rb#L268) —
`project_params` does not permit `document_type` at all today; only `import_params` does.
**This is the actual blocker: nothing outside the importer can create a slideshow.**

Permit it in `project_params`, but only on `create`. On `update`, drop it before it
reaches the model. Decision 3 is a write-once rule for the slideshow axis, and the
cheapest place to enforce "you cannot become or stop being a deck" is the boundary,
rather than leaning on the target validation to notice after the fact.

Because the enum keeps all three values, an update that *did* slip through with
`article`↔`book` would be harmless — but permitting it invites the UI to start offering
it, and the root element is where that choice belongs.

### 1.2 Keep the target guard

`Project#targets_supported_by_document_type`
([project.rb:368](../app/models/project.rb#L368)) stays. It costs one validation and it
is the guard that catches a console edit or a future feature; deleting it because
"nothing in the UI can change the type" is how the trap it documents comes back.

`Target::Catalog`'s `document_types: %i[ slideshow ]` and `available_for?` need no change,
and the validation message still reads correctly.

### 1.3 The import path — nothing to do

`@pretextbook/import` sends `DocumentKind` as `"article" | "book"`, never `"slideshow"`.
With the enum unchanged, both values remain valid and the import path keeps working
untouched. *(The previous plan needed a normalization shim here purely to survive its own
collapse.)*

### 1.4 Optional, deferred — derive article/book from the source

If the stale-row concern in decision 2 ever grows teeth, the fix is to derive rather than
collapse: on save, read the root division's tag and set `document_type` from it for the
article/book axis only, leaving `slideshow` alone. Cheap, one callback, and it makes the
row correct instead of merely unread. Not part of this work.

### 1.5 Tests

Nothing existing changes. Fixtures, `project_test.rb`'s conversion guards,
`target_test.rb:181`, and the import controller tests all stay as they are. Add:

- `project_params` permits `document_type` on create and ignores it on update.
- Creating with `document_type: "slideshow"` yields a slideshow project with the right
  default target (Part 2.3).

---

## Part 2 — Creating a slideshow (Rails) ✅ done

### 2.1 The new-project dialog

[new.html.erb](../app/views/projects/new.html.erb) — the "New empty document" dialog
currently asks only for a markup style; the document type has never been a choice there.
Add the axis:

- A **Document / Slideshow** pair above the markup-style radios, as a `radio_button
  :document_type` on the same `form_with`. "Document" says something like *an article or
  a book — you choose in the editor*; "Slideshow" says *a reveal.js deck*. Post the value
  `article` for Document: it is the enum's default and the tag the editor will synthesize.
- The two axes are **independent** — decision 1 allows every markup style for a slideshow,
  so no radio disables another and the `new-project` Stimulus controller needs no changes
  at all. Six combinations, all supported.
- The validation re-render path (`create`'s `else` branch at
  [projects_controller.rb:83](../app/controllers/projects_controller.rb#L83), which
  re-renders `:new`) must preserve the selection, like the markup style already does.

Leave the template and import cards alone.

### 2.2 The default target

[project.rb:83](../app/models/project.rb#L83) — `DEFAULT_TARGET` is Website for every
project, built by `before_create :build_default_target`
([:354](../app/models/project.rb#L354)). A website is a legal output for a slideshow, but
it is not what someone making slides wants first. Pick by document type: a slideshow gets
`{ name: "Slides", kind: "revealjs" }`.

Note while editing this: `before_create` runs **after** validation, so a target built
there is never validated against `Target#kind_available_for_document_type`. That is safe
here precisely because we derive the kind from the document type — but it means this hook
is not the place to trust user input, now or later.

### 2.3 Starter content

`ProjectsController#new` ([:59](../app/controllers/projects_controller.rb#L59)) builds the
root division with no `source`; the editor synthesizes the wrapper element on load
(Part 3.1). An empty `<slideshow>` renders as a blank deck, which is a poor first screen.

Today the starter source comes from `Division`'s three constants
([division.rb:15-17](../app/models/division.rb#L15)), each reading one file from
`app/default_docs/`. Because decision 1 allows all six combinations, a slideshow needs its
own file **per markup style**, not one file:

- `app/default_docs/slideshow.xml` — `<slideshow>` + `<title>` + one starter `<slide>`
- `app/default_docs/slideshow.tex` — `\slideshow{…}\label{document}` + one
  `\begin{frame}{…}`
- `app/default_docs/slideshow.md` — `division: slideshow` frontmatter + one `##` heading

Each starter includes a slide, not just the root: an empty `<slideshow>` renders as a
blank deck, which is a poor first screen, and the slide doubles as the example of the
markup an author needs (especially for LaTeX, where `frame` is not guessable).

Select among the six in `Division`, keyed on the owning project's document type, rather
than branching in the controller — the three existing constants already live there and
the selection is the same shape.

The editor's wrapper synthesis still has to handle slideshows (imports, legacy rows, other
hosts) — this just means a project created through *our* form never depends on it.

---

## Part 3 — The `<slideshow>` root in the editor ✅ done

### 3.1 `projectType` plumbing

`projectType` is typed `"article" | "book"` and collapses everything non-book to
`article`:

- [Editors.tsx:203](../packages/web-editor/src/components/Editors.tsx#L203) (the prop)
- [sectionUtils.ts:2600-2603](../packages/web-editor/src/sectionUtils.ts#L2600) —
  `normalizeDivisionsOnLoad`, the only real consumer
- [editorStore.ts:177](../packages/web-editor/src/store/editorStore.ts#L177) and `:354`
- [App.tsx:517](../packages/web-editor/src/App.tsx#L517) (the standalone demo host)

**Widen to `"article" | "book" | "slideshow"`** — root *element* names, which is what
`normalizeDivisionsOnLoad` is actually picking. With decision 2 the Rails side is then an
identity map: [editor.jsx:134](../app/javascript/controllers/react/editor.jsx#L134)
becomes a check that `json.document_type` is one of the three, falling back to `article`.
The `EditorState` and `rootMeta` typedefs above it (`:53`, `:135`) widen to match.

In `normalizeDivisionsOnLoad`, replace `projectType === "book" ? "book" : "article"` with
a lookup against the existing `ROOT_DIVISION_TYPES` set
([sectionUtils.ts:2151](../packages/web-editor/src/sectionUtils.ts#L2151)), so the next
root type added needs no edit here.

**`store.projectType` is dead** — written by `syncState` and read by nothing. Delete the
field rather than widening it; a mirrored value nobody consumes is just another place to
forget.

### 3.2 `wrapDivisionForPreview` — the preview correctness bug

[sectionUtils.ts:2547](../packages/web-editor/src/sectionUtils.ts#L2547). **Still
present**, and not fixed by the preview work that landed: root previews are fine (root
types get no wrapper at all), but a **non-root** division falls through to an `<article>`
wrapper. So previewing one `<section>` of slides produces
`<pretext><article><section>…<slide>…`. pretext-html detects `<slide>` and correctly
selects the slides target, so `pretext-revealjs.xsl` receives an `<article>` root — a
deck-shaped page with nothing in it.

The function only ever sees the division's *own* type, never the project's. Add the root
type as a parameter and use it for the fallback wrapper:

```
root type "slideshow" + non-root division  →  <slideshow><title>…</title>…</slideshow>
part/chapter                               →  <book>   (unchanged)
everything else                            →  <article> (unchanged)
```

The single call site is
[Editors.tsx:1425](../packages/web-editor/src/components/Editors.tsx#L1425), which
already has the root division in scope.

The `<title>` is right: the compiled schema
(`node_modules/@pretextbook/schema/assets/pretext.json`) defines `slideshow` as a required
`title` followed by a choice of `section*` or `slide*`. Same shape as `<article>`/`<book>`,
which is why the wrapper adds one.

**This failure is silent** — a wrong wrapper yields an empty page, not an error — which is
the argument for pinning it with a unit test rather than a visual check.

Measured through the real renderer before and after, on the same section of two slides:

| Wrapper | Detected target | Rendered output |
| --- | --- | --- |
| `<article>` (the bug) | `slides` | **17 bytes** — no `.slides` container, no slides |
| `<slideshow>` (fixed) | `slides` | 4191 bytes, `.slides` container, both slides |

The wrapper is chosen from the **root division's own tag**, falling back to the
`projectType` prop: the source is authoritative for which root element a document has, and
a host that let the author switch article↔book may not have echoed the prop back yet.

### 3.3 Close the root-type switch

`SWITCHABLE_ROOT_TYPES = ["article", "book"]`
([toc/types.ts:119](../packages/web-editor/src/components/toc/types.ts#L119)) stays as it
is — that is decision 3's article↔book freedom, and it is correct. But it is not
sufficient on its own. `SectionEditForm` builds its dropdown as
`[draft.type, ...SWITCHABLE_ROOT_TYPES]` when the current type is not in the switchable
list ([SectionEditForm.tsx:56-58](../packages/web-editor/src/components/toc/SectionEditForm.tsx#L56)),
so a slideshow root would offer **Slideshow, Article, Book** and the author could pick
Article.

The fallback now renders a non-switchable root type as the only option, and the `<select>`
is disabled when it has nothing to offer. Covered by a test — this is a one-line
regression waiting to happen.

---

## Part 4 — Preview

### 4.1 / 4.2 — Done

The local render and the deck preview UI landed on `main`. Two follow-ups worth confirming
while working nearby, neither blocking:

- `renderPreviewHtml` relies on pretext-html's detection rather than passing `target`
  explicitly. Detection is a string scan for `<slide>`; once Part 3.2 gives the caller the
  root type, passing it is cheaper and does not depend on the scan getting it right.
- Two-way preview sync in decks is unverified. `previewSync.ts` depends on `@unique-id`s
  surviving into the rendered page, and the reveal.js stylesheets may emit fewer of them
  than the HTML ones. Check it, and make sure it degrades to "no scroll" rather than
  scrolling to the wrong place.

### 4.3 The fallback build server — still open

Only engines without JSPI reach this path
([Editors.tsx:1515](../packages/web-editor/src/components/Editors.tsx#L1515)).

- **`onRebuild` cannot say "this is a deck."** Its signature
  ([LivePreview.tsx:49](../packages/web-editor/src/components/LivePreview.tsx#L49)) is
  `(content, title, postToIframe)`. Widen it to carry the target. This is a public API
  change on the `onPreviewRebuild` prop, cheap now that the package is an in-repo
  workspace with exactly one consumer.
- **Translate the vocabulary at the boundary.** pretext-html says `"slides"`; the build
  server says `"revealjs"`. `onPreviewRebuild` in
  [editor.jsx:1064](../app/javascript/controllers/react/editor.jsx#L1064) maps one to the
  other. Do not wire `slides` straight through.
- **`ProjectsController#preview`**
  ([:214](../app/controllers/projects_controller.rb#L214)) builds `post_params` from
  `source` + `token`. Add `target` **only when present and in `%w[ html revealjs ]`** — it
  is optional server-side and detection-from-source is the safer default, so forwarding
  nothing beats forwarding junk.
- `/tryit/preview` shares this action and posts no target, so it keeps detecting. That is
  the reason the parameter must stay optional rather than defaulting to `html` here.

---

## Part 5 — Authoring affordances

Lower priority than the above, but the difference between "slideshows exist" and
"slideshows are usable".

**Slides are not divisions.** A `<slide>` is a block inside a `<slideshow>` or a
`<section>`, so the TOC can only ever show sections and adding a slide is raw typing in
Monaco. Add a slide snippet to `editorConfigs/snippets.ts` as a **block** construct, which
`insertContext.ts` already places correctly (after the enclosing `<p>` if the cursor is in
one, inline otherwise). Gate its appearance in the Insert menu on a slideshow root —
offering it in an article produces a schema error for a menu item we handed the author.

The snippet body is **per format**, and the LaTeX one is not guessable: `\begin{frame}{…}`,
not `\slide{…}` (which converts to an unknown-macro TODO). Markdown's is a `##` heading.

**A `<slideshow>` may hold `<slide>` children directly**, with no `<section>` layer at
all — the schema is `title, (section* | slide*)` — and the division tree has no
representation for that. The two branches are exclusive: a deck is *either* sectioned *or*
flat, and `ALLOWED_CHILD_DIVISION_TYPES.slideshow = ["section"]` currently assumes the
sectioned form. Decision 1 raises the stakes here — a Markdown deck written with only `##`
headings lands in the flat form through an ordinary authoring path, so this is now
reachable rather than hypothetical. Decide whether the TOC lists slides as read-only
leaves or ignores them entirely. Still deferred, but flat is the shape most short decks
will have.

---

## Sequencing

Parts 1–3 are done: a slideshow can be created in any of the three markup styles, and the
editor types, previews and protects it correctly. What remains is independent of both:
**Part 4.3** (the build-server fallback, reached only by engines without JSPI) and **Part
5** (authoring affordances — the "New slide" insertion is the gap an author hits first,
since slides are not divisions and the TOC cannot add one).

## Traps

- **`before_create :build_default_target` runs after validation**, so the target it builds
  is never validated against the project's document type.
- **A wrong preview wrapper fails silently** — an empty deck, not an exception. Unit-test
  `wrapDivisionForPreview` rather than trusting a visual check.
- **`SectionEditForm`'s dropdown fallback silently re-opens the conversion** decision 3
  forbids, from a single line that reads like defensive code.
- **Two-way preview sync in decks is unverified** (see 4.1).
- **Integer enum values are never reused** here, per `docs/build-targets.md`. Decision 2
  means none are retired, so nothing to do — but the rule still applies if a value is ever
  removed.
