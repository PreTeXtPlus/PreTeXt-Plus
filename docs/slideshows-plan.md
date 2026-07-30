# Slideshows

Plan of record for first-class `<slideshow>` support. **Not started** — parked on the
`slides` branch until we pick it back up.

## Context

A slideshow is a PreTeXt document whose root element is `<slideshow>` rather than
`<article>`/`<book>`, built to a reveal.js deck (or a Beamer PDF) instead of a website.
Pieces of this already exist — the target catalog has restricted `revealjs`/`beamer` to
slideshows since the build-targets work, and the editor knows `slideshow` as a division
type — but there is no way to *make* one, and the preview only half works.

### Decisions taken up front

1. **Slideshows are PreTeXt-classic markup only, for now.** The LaTeX converter already
   understands a `\slideshow{…}` header and `contentConversion.ts` lists it as a root
   header, so the door is open — but the new-project flow will not offer LaTeX- or
   Markdown-style slideshows until someone has actually exercised those paths.

2. **`document_type` collapses to `document` vs `slideshow`.** Article-vs-book is a
   property of the root element in the source, and the TOC already switches between them
   freely (`SWITCHABLE_ROOT_TYPES`). Carrying the same distinction a second time on the
   project row buys nothing and gives two places to disagree. What the project row *does*
   need to say is the one thing that is not freely switchable: whether this is a deck.

3. **No conversion between a document and a slideshow, in either direction.** Not a
   temporary limitation — changing the root element out from under a project means
   rewriting the source, invalidating targets, and re-deciding what every division means.
   The document type is fixed when the project is created.

4. **The local WASM render is the primary preview path.** `@pretextbook/pretext-html`
   0.5.0 renders decks in-page. The lite build server remains the fallback for engines
   without WebAssembly JSPI; it takes an **optional** `target` of `html` or `revealjs`
   and detects the format from the source when it is absent.

### What already works — do not redo

- `Project` has the enum value; `Target::Catalog` restricts `revealjs`/`beamer` to it,
  enforced three ways (picker, `Target`, `Project`). See `docs/build-targets.md`.
- The editor knows `slideshow` as a `DivisionType` throughout: TOC labels, id prefix,
  `ALLOWED_CHILD_DIVISION_TYPES.slideshow = ["section"]`, root-division lookups,
  `ROOT_DIVISION_TYPES` in `sectionUtils.ts`.
- `railsDivisionToEditor` derives a PreTeXt root's type from its own tag
  ([editor.jsx:136](../app/javascript/controllers/react/editor.jsx#L136)), so a
  `<slideshow>` root already types itself correctly once one exists.
- pretext-html 0.5.0 auto-detects a deck and returns `target` from `renderHtml`. A
  **root-division** live preview of a slideshow very likely already renders as a deck
  today. Non-root previews do not — see Part 3.2.

---

## Part 1 — Collapse `document_type` to `document` vs `slideshow`

Independent of everything else here; land it first and on its own.

### 1.1 Migration

`projects.document_type` is an integer with `default: 0, null: false`, currently
`{ article: 0, book: 1, slideshow: 2 }`. Map `book` onto `article`'s integer and retire
`1`:

```ruby
class CollapseArticleAndBookDocumentTypes < ActiveRecord::Migration[8.1]
  def up
    Project.where(document_type: 1).update_all(document_type: 0)
  end

  def down
    # Irreversible: which of these rows were books is not recoverable, and it does not
    # matter — the root element in the source is where that has always really lived.
    raise ActiveRecord::IrreversibleMigration
  end
end
```

`default: 0` stays correct and the column is untouched. **Integer `1` is retired
permanently** — the same rule `builds.status` follows in `docs/build-targets.md`.
Reusing it later silently reinterprets whatever these rows become. Do not renumber
`slideshow` down to 1 to "tidy up"; that rewrites the meaning of every existing deck.

### 1.2 Model

[project.rb:40](../app/models/project.rb#L40):

```ruby
enum :document_type, { document: 0, slideshow: 2 }, default: :document, suffix: true, validate: true
```

`Target::Catalog`'s `document_types: %i[ slideshow ]` and `available_for?` need no
change, and the validation message ("only available for slideshow projects") still
reads correctly.

Keep `Project#targets_supported_by_document_type` even though decision 3 means nothing
in the UI changes the type. It costs one validation and it is the guard that catches a
console edit or a future feature; deleting it is how the trap it documents comes back.

### 1.3 The import path — a real trap

`import_params` permits `document_type`, and `@pretextbook/import` sends one:
`DocumentKind` is `"article" | "book"`, never `"slideshow"`. After the collapse, both
values are unknown to the enum. With `validate: true` an unknown value does **not**
raise — the record simply fails validation — so an import would break with
"Document type is not included in the list" and no obvious cause.

Normalize at the boundary in `ProjectsController#import_params`, which also
future-proofs for the day the importer learns to detect a deck:

```ruby
# @pretextbook/import reports the root element it found ("article"/"book"); we only
# care whether it is a slideshow.
attrs[:document_type] = attrs[:document_type].to_s == "slideshow" ? "slideshow" : "document"
```

(Simply dropping `document_type` from the permitted list would work today and lose
nothing, since the importer cannot produce a slideshow — but it silently starts
discarding real information the moment that changes.)

### 1.4 Fixtures and tests

- `test/fixtures/projects.yml` — five `article` and one `book` become `document`;
  the `slides` fixture is untouched.
- `test/models/project_test.rb:129-149` — the conversion-guard tests change
  `:article`/`:book` to `:document`. The guard itself is unchanged.
- `test/models/target_test.rb:181` — `for_document_type(:article)` becomes
  `for_document_type(:document)`.
- `test/controllers/projects_controller_test.rb:750,787,804` — the import tests post
  `document_type: "article"/"book"` and assert `project.book_document_type?`, which
  stops existing. Rewrite against the normalization in 1.3.

---

## Part 2 — Creating a slideshow (Rails)

### 2.1 Permit `document_type`

[projects_controller.rb:227](../app/controllers/projects_controller.rb#L227) —
`project_params` does not permit `document_type` at all today; only `import_params`
does. This is the actual blocker: nothing outside the importer can create a slideshow.

Permit it. Because of decision 3 it must be **write-once**: permit it on `create` and
reject it on `update`, rather than relying on the target validation to catch changes
after the fact.

### 2.2 The new-project dialog

[new.html.erb](../app/views/projects/new.html.erb) currently asks only for a markup
style; the document type has never been a choice there (every project is an article
until the author switches the root element in the editor). Add the axis:

- A **Document / Slideshow** pair above the markup-style radios, as a `radio_button
  :document_type` on the same `form_with`. "Document" says something like *an article or
  a book — you choose in the editor*; "Slideshow" says *a reveal.js deck*.
- Extend the `new-project` Stimulus controller so choosing Slideshow disables the LaTeX
  and Markdown radios and forces `pretext` (decision 1). The template already has a
  disabled-card style for the "coming soon" case — reuse it rather than inventing a
  second disabled look.
- The validation re-render path (`create`'s `else` branch, which re-renders `:new`) must
  preserve the selection, like the markup style already does.

### 2.3 The default target

[project.rb:65](../app/models/project.rb#L65) — `DEFAULT_TARGET` is Website for every
project, built by `before_create :build_default_target`. A website is a legal output for
a slideshow, but it is not what someone making slides wants first. Pick by document
type: a slideshow gets `{ name: "Slides", kind: "revealjs" }`.

Note while editing this: `before_create` runs **after** validation, so a target built
there is never validated against `Target#kind_available_for_document_type`. That is
safe here precisely because we derive the kind from the document type — but it means
this hook is not the place to trust user input, now or later.

### 2.4 Starter content

`ProjectsController#new` builds the root division with no `source`; the editor
synthesizes the wrapper element on load (Part 3.1). An empty `<slideshow>` renders as a
blank deck, which is a poor first screen.

Seed it server-side, mirroring how docinfo already works — `Project.set_default_docinfo`
is called from `create` and reads from `app/default_docs/`. Add
`app/default_docs/slideshow/root.xml` holding a `<slideshow>` with a title and one
starter `<slide>`, plus a `Project#set_default_root_source` called from `create` when the
root division's source is blank.

The editor's wrapper synthesis still has to handle slideshows (imports, legacy rows,
other hosts) — this just means a project created through *our* form never depends on it.

---

## Part 3 — The `<slideshow>` root in the editor

### 3.1 `projectType` plumbing

`projectType` is typed `"article" | "book"` in three places and collapses everything
non-book to `article`:

- [Editors.tsx:161](../packages/web-editor/src/components/Editors.tsx#L161) (the prop)
- [sectionUtils.ts:2419-2422](../packages/web-editor/src/sectionUtils.ts#L2419) —
  `normalizeDivisionsOnLoad`, the only real consumer
- [editorStore.ts:139](../packages/web-editor/src/store/editorStore.ts#L139) and `:304`

**Keep the editor's vocabulary as root *element* names** — `"article" | "book" |
"slideshow"` — and let Rails map its own `document` onto `article`. The collapse in
Part 1 is a decision about our project model, not about the component library: the
library still needs to be able to synthesize a `<book>` wrapper for a host that wants
one, and `normalizeDivisionsOnLoad` is picking a literal tag name.

In `normalizeDivisionsOnLoad`, replace `projectType === "book" ? "book" : "article"`
with a lookup against the existing `ROOT_DIVISION_TYPES` set, so the next root type
added needs no edit here.

[editor.jsx:286](../app/javascript/controllers/react/editor.jsx#L286) does the mapping:
`json.document_type === "slideshow" ? "slideshow" : "article"`. The `EditorState` and
`rootMeta` typedefs above it (`:78`, `:165`) need widening to match.

**`store.projectType` is dead** — it is written by `syncState`
([Editors.tsx:1120](../packages/web-editor/src/components/Editors.tsx#L1120)) and read
by nothing. Delete the field rather than widening it; a mirrored value nobody consumes
is just another place to forget.

### 3.2 `wrapDivisionForPreview` — the preview correctness bug

[sectionUtils.ts:2367](../packages/web-editor/src/sectionUtils.ts#L2367). Root previews
are fine (root types get no wrapper at all), but a **non-root** division falls through
to an `<article>` wrapper. So previewing one `<section>` of slides produces
`<pretext><article><section>…<slide>…`. pretext-html's `detectRenderTarget` scans for
`<slide>` and correctly reports `"slides"`, so `pretext-revealjs.xsl` then receives an
`<article>` root — a deck-shaped page with nothing in it.

The function only ever sees the division's *own* type, never the project's. Add the root
type as a parameter and use it for the fallback wrapper:

```
root type "slideshow" + non-root division  →  <slideshow><title>…</title>…</slideshow>
part/chapter                               →  <book>   (unchanged)
everything else                            →  <article> (unchanged)
```

The single call site is [Editors.tsx:1320](../packages/web-editor/src/components/Editors.tsx#L1320),
which already has `rootDivision` in scope. Confirm against the schema that `<slideshow>`
wants a `<title>` first child the way `<article>`/`<book>` do — the wrapper adds one for
exactly that reason, and it is what makes the difference between a build and a 500.

**This failure is silent**, which is the argument for pinning it with a unit test:
a wrong wrapper yields an empty page, not an error.

### 3.3 Close the root-type switch

`SWITCHABLE_ROOT_TYPES = ["article", "book"]`
([toc/types.ts:89](../packages/web-editor/src/components/toc/types.ts#L89)) stays as it
is — but that is not sufficient on its own. `SectionEditForm` builds its dropdown as
`[draft.type, ...SWITCHABLE_ROOT_TYPES]` when the current type is not in the switchable
list, so a slideshow root today offers **Slideshow, Article, Book** and the author can
pick Article. Decision 3 says that must not be possible.

Change that fallback so a non-switchable root type renders as the only option (or a
disabled control), instead of being prepended to the switchable ones. Cover it with a
test — this is a one-line regression waiting to happen.

---

## Part 4 — Preview

### 4.1 Local render

[wasmPreview.ts:102](../packages/web-editor/src/components/wasmPreview.ts#L102) —
`renderPreviewHtml` passes `cssTheme: "greeley"` and nothing else, and drops the
`target` that `renderHtml` returns.

- **Pass `target` explicitly**, derived from the root division type, rather than relying
  on detection. Detection stays as the fallback when a caller says nothing; being
  explicit is cheaper and does not depend on a string scan getting the answer right.
- **Pass `revealView: "scroll"` by default.** A deck opens as a presentation — one slide,
  arrow keys — which is what an audience should see and a bad way to write. Scroll view
  shows the whole deck like every other preview in the editor.
- **`cssTheme` is meaningless for a deck**; `revealTheme` is the knob (reveal's own
  themes: `simple`, `white`, `black`, …). Pick a default and pass it only for decks.
- **Return `target` from `PreviewRender`** so `LivePreview` can tell a deck from a
  document without re-inspecting anything.

### 4.2 Deck-only preview UI

[LivePreview.tsx](../packages/web-editor/src/components/LivePreview.tsx) — add a
Slides/Scroll toggle to the preview header, rendered only when `target === "slides"`.

Switch views by re-injecting, not by talking to the live deck: `injectRevealBridge(html,
view)` rewrites the HTML already in hand and the iframe's `srcDoc` is re-assigned. The
pretext-html docs are explicit that scroll view restructures the DOM and
`Reveal.destroy()` does not undo it, so a destroy/re-initialize toggle leaves debris.
No re-render is needed.

Also: `theme` (light/dark) does nothing for a deck — it loads none of the PreTeXt JS
that implements it — so `defaultPreviewToLight()` is inert there and no light/dark
affordance should be offered for decks. A dark reveal theme is the only way to get a
dark deck.

### 4.3 The fallback build server

Only engines without JSPI reach this path.

- **`onRebuild` cannot say "this is a deck."** Its signature
  ([LivePreview.tsx:29](../packages/web-editor/src/components/LivePreview.tsx#L29)) is
  `(content, title, postToIframe)`. Widen it to carry the target. This is a public API
  change on the `onPreviewRebuild` prop, which is cheap now that the package is an
  in-repo workspace with exactly one consumer.
- **Translate the vocabulary at the boundary.** pretext-html says `"slides"`; the build
  server says `"revealjs"`. `onPreviewRebuild` in `editor.jsx` maps one to the other.
  Do not wire `slides` straight through.
- **`ProjectsController#preview`**
  ([:174-193](../app/controllers/projects_controller.rb#L174)) builds `post_params` from
  `source` + `token`. Add `target` **only when present and in `%w[ html revealjs ]`** —
  it is optional server-side and detection-from-source is the safer default, so
  forwarding nothing beats forwarding junk.
- `/tryit/preview` shares this action and posts no target, so it keeps detecting. That
  is the reason the parameter must stay optional rather than defaulting to `html` here.

---

## Part 5 — Authoring affordances

Lower priority than the above, but the difference between "slideshows exist" and
"slideshows are usable".

**Slides are not divisions.** A `<slide>` is a block inside a `<slideshow>` or a
`<section>`, so the TOC can only ever show sections and adding a slide is raw typing in
Monaco. At minimum, add a "New slide" insertion (a `CodeEditorMenu` action or a Monaco
snippet). `@pretextbook/completions` should already offer the tag from the schema —
confirm before building anything.

**A `<slideshow>` may hold `<slide>` children directly**, with no `<section>` layer at
all, and the division tree has no representation for that. Decide whether the TOC lists
slides as read-only leaves or ignores them entirely. Deferred, but it is the shape most
short decks will actually have.

---

## Sequencing

Part 1 stands alone and should land first — it touches fixtures and several test files
and does not want to be tangled with feature work. Part 2 depends on it. Parts 3 and 4
depend on the pretext-html 0.5.0 bump (see Traps) and can go together. Part 5 is
independent of all of it.

## Traps

- **`@pretextbook/pretext-html` 0.5.0 is uncommitted** in `package.json` and
  `package-lock.json` on this branch. 0.4.0 has no slides target, no
  `detectRenderTarget`, and no reveal view control — Parts 3 and 4 do not exist without
  the bump. It must land with them.
- **Enum integer `1` is retired forever** after Part 1. Reusing it silently reinterprets
  rows.
- **`@pretextbook/import` emits `document_type: "article" | "book"`** and never
  `"slideshow"`. Part 1 breaks the import path unless 1.3 lands with it, and the failure
  is a validation error with no obvious cause.
- **`before_create :build_default_target` runs after validation**, so the target it
  builds is never validated against the project's document type.
- **A wrong preview wrapper fails silently** — an empty deck, not an exception. Unit-test
  `wrapDivisionForPreview` rather than trusting a visual check.
- **Two-way preview sync in decks is unverified.** `previewSync.ts` depends on
  `@unique-id`s surviving into the rendered page, and the reveal.js stylesheets may emit
  fewer of them than the HTML ones. Check it, and make sure it degrades to "no scroll"
  rather than scrolling to the wrong place.
