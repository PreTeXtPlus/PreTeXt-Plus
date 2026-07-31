# Publication settings

Publisher options an author picks from a modal — theme, page size, division numbering —
which land in the publication file each build is handed.

The publication file used to be a constant: every build of every project got the same four
lines. This makes a curated slice of it editable, without exposing the file itself and
without supporting every option in it.

## The three levels

Each level overrides the one above it **per option**, never wholesale — a project that sets
only a theme still inherits the account's chunking level.

```
account defaults  →  project  →  output (target)
```

Storage is a `publication_settings` jsonb column on `users`, `projects` and `targets`,
holding only the keys an author actually chose. **"Inherit" is the absence of a key**,
which is what makes resolution a plain `Hash#merge` and what makes clearing an override
possible: the form submits an empty value, `HasPublicationSettings` drops it, and the level
above takes over again. Nothing ever stores a blank.

`Publication::Settings` does the resolving. `Publication::Settings.effective_for(owner)` is
the merged hash a build consumes; the instance methods (`own`, `inherited`,
`blank_choice_label`) are what let the modal say *Inherit — Salem (from your account)*
rather than showing an inherited value as though it had been chosen here.

## The catalog

`Publication::Catalog` is the one place that knows what an option is and how PreTeXt spells
it. Adding one more is one entry there — the modal, its tabs, the strong parameters, the
validation and the XML writer all read from it.

Options belong to a **family**, which is both the tab they appear under and the set of
outputs they reach. One declaration, because they are the same question: an author asking
"why didn't my PDF change?" is asking which format a setting was for.

| Family | Reaches (`Target::Catalog` slugs) |
|---|---|
| General | every output |
| HTML | `website`, `scorm` |
| PDF | `pdf`, `latex` |
| EPUB | `epub`, `kindle` |
| Braille | `braille` |

| Key | Family | Publication path | Values |
|---|---|---|---|
| `division_numbering_level` | General | `numbering/divisions/@level` | book `0`–`4`, article `0`–`3` |
| `numbering_{family}_level` × 7 | General | `numbering/{family}/@level` | same range as the division level |
| `numbering_{family}_distinct` × 4 | General | `numbering/{family}/@distinct` | `yes`, `no`; PreTeXt's default is `yes` for projects and `no` for the rest |
| `toc_level` | General | `common/tableofcontents/@level` | book `0`–`3`, article `0`–`2` |
| `exercise_{type}_{part}` × 20 | General | `common/exercise-{type}/@{part}` | `yes` (PreTeXt's default), `no` |
| `worksheet_{margin,top,right,bottom,left}` | General | `common/worksheet/@{side}` | a length, e.g. `0.75in` (PreTeXt's default for `margin`; a side falls back to `margin`) |
| `{band}_{position}` × 12 | General | `common/worksheet/{band}/@{position}` | one line of text; empty by default |
| `theme` | HTML | `html/css/@theme` | `default-modern` (PreTeXt's default), `denver`, `tacoma`, `salem`, `greeley`, `boulder` |
| `dark_mode` | HTML | `html/css/@provide-dark-mode` | `yes` (PreTeXt's default), `no` |
| `chunk_level` | HTML | `common/chunking/@level` | book `0`–`3`, article `0`–`2` |
| `embed_button` | HTML | `html/@embed-button` | `yes` (**our** default), `no` (PreTeXt's) |
| `knowl_{block}` × 18 | HTML | `html/knowl/@{block}` | `yes`, `no`; PreTeXt's default differs per block |
| `latex_print` | PDF | `latex/@print` | `no` (PreTeXt's default), `yes` |
| `latex_sides` | PDF | `latex/@sides` | `one`, `two` |
| `epub_cover` | EPUB | `epub/cover/@front` | the project's own uploaded images |
| `braille_page_width` | Braille | `braille/page/@width` | whole number, 1–100 (PreTeXt's default 40) |
| `braille_page_height` | Braille | `braille/page/@height` | whole number, 1–100 (PreTeXt's default 25) |

The Braille and EPUB tabs show on **any** project, not only ones that have built either —
an author who does not know PreTeXt.Plus embosses braille will never go looking for the
setting. That is why the EPUB cover, with no image to offer, renders a line saying what to
upload rather than vanishing.

### Groups and grids

Most of the catalog is long tails: eighteen knowl switches, twenty exercise components,
seventeen printout fields, each one the same question asked about a different thing. Loose
in the panel they would bury the handful of settings an author actually came for, so they
go behind a `<details>` — `Publication::Catalog::GROUPS`, one entry per disclosure, and
`Option#group` naming which.

A `Group` is the disclosure. A `Grid` is a table inside one, and a group holds an ordered
list of them; a group with none is a plain list of label-and-control rows.

| Group | Family | Options | Grids |
|---|---|---|---|
| `numbering` | General | 11 | 7 numbered families × (level, counter) — **ragged** |
| `exercise_components` | General | 20 | 5 exercise kinds × 4 components |
| `printout` | General | 17 | *Margins*: 5 columns, no rows · *Headers and footers*: 4 bands × 3 positions |
| `knowls` | HTML | 18 | none — a list |

Splitting the two apart is what lets one disclosure hold two tables that share a subject
and nothing else: page margins are one row of labelled columns, and headers are a grid.
`Grid#rows` is optional for exactly that — a grid without rows draws one unlabelled row and
no row-header column, and `key_prefix` is what keeps its keys from being as generic as its
columns (`worksheet_top`, not `top`).

`Group#after` names the loose option a disclosure sits **under**, for a group that
elaborates one setting rather than adding a subject of its own — the numbering table
belongs beneath division numbering, where an author is standing when they want it. Left
nil, a group goes at the foot of its panel. This is why `Settings#sections` returns one
ordered list of `Section`s (each holding either an option or a group) rather than "the
loose options, then the groups": the two interleave.

Five things follow from this being a catalog concept rather than a view one:

- **Options are generated from the very lists the table is drawn from.** `EXERCISE_TYPES` ×
  `EXERCISE_COMPONENTS` produce both the twenty `Option`s and the rows and columns, joined
  by `Grid#cell_key`; `Catalog.grid_of` is how each generator finds the grid it is filling
  rather than re-deriving keys and hoping the two agree. A row added there brings its
  options with it — pinned by a test asserting that a group's options and its grids' cells
  name exactly the same set of keys, in both directions.
- **A grid may be ragged.** The numbering table has no `@distinct` for blocks, equations or
  footnotes, so three cells hold no option; the view renders a muted `—` there so the gap
  reads as *not applicable* rather than as a control that failed. That is why the coverage
  test is set equality rather than "every cell is filled".
- **A `<details>` hides its fields without unmounting them**, so a knowl changed and then
  collapsed still submits, the same property the tabs rely on.
- **Grouped controls use `compact_blank_label`, not `blank_choice_label`.** Twenty selects
  across four columns have no room for *Inherit — Show (from your account)*, and a select
  clipped mid-word says less than a short label that is true. The compact form keeps the
  value and drops the provenance; the long form goes on the control's `title`.
- **A cell with no row header carries its own accessible name.** Everywhere else the row
  and column headings name the control; in the margins row there is no row heading, so the
  option's label (*Top margin*) becomes the field's `aria-label`.

### Defaults we write ourselves

`embed_button` is the one option where PreTeXt's default is not the one we want: PreTeXt
ships the embed button off, and a reader who wants a page inside their LMS should not have
to hand-write an iframe. `Option#applied_default` is that value, and
`Catalog.applied_defaults` is what `PublicationFileBuilder` writes into **every** file
before the author's settings merge on top.

It is deliberately not part of `PublicationFileBuilder::BASE`. BASE is what no author may
change; an applied default is an ordinary option that happens to start switched on, and
merging is what lets an author switch it off. `Option#default_note` is why the empty choice
reads *PreTeXt.Plus default (Offer an embed button)* — calling that "PreTeXt's default"
would name the opposite of what a build does.

### Kinds of choice

`Option#choices` says both what an option accepts and how the modal asks for it:

| `choices` | Control | Used by |
|---|---|---|
| Array of `[value, label]` | select | theme, dark mode, latex print/sides, knowls, exercise components |
| Hash keyed by document type | select | the level options, which the document's structure bounds |
| `WholeNumber(min:, max:, unit:)` | number field | braille page width and height |
| `FreeText(pattern:, max_length:)` | text field | printout margins and headers |
| `PROJECT_IMAGES` | select built per project | the EPUB cover |

`Option#permits?` is the single check validation makes, so the branch over these lives in
one place rather than in the concern that stores them. The typed and project-scoped kinds
cannot answer for themselves — a project's images are not the catalog's to know, and a
number has no list — so **`Publication::Settings` is what the modal asks** (`choices_for`,
`select_choices_for`, `label_for`, `offers?`, `placeholder_for`), and it delegates to the
option for the static cases.

Four consequences worth knowing:

- **The EPUB cover value is an asset's filename in the external directory.** PreTeXt
  resolves `epub/cover/@front` against that directory, and `ProjectArchiveBuilder` writes
  each asset there as `<ref><ext>` — so the picker offers exactly those names, and the two
  have to keep agreeing. Validation checks the *shape* (`EXTERNAL_FILENAME`: a bare
  filename, no path), not membership: the concern also runs on `User`, which has no
  project, and an asset deleted later must not make a project unsaveable.
- **Braille page size is a number, not a list.** An embosser's line width is whatever that
  embosser does, so a dropdown of the few we thought of would be wrong for the next one.
  The 1–100 bounds are ours; PreTeXt takes any positive whole number and falls back with a
  `PTX:FALLBACK` message otherwise.
- **`FreeText#pattern` is a security boundary, not a nicety.** A printout margin is
  interpolated straight into `\newgeometry{left=…}` in LaTeX that a build server then
  compiles, so what the pattern permits is the whole of what stands between a text field
  and that command line. `LENGTH` allows a number plus a unit that *both* CSS and TeX
  understand — ruling out `px` and `rem`, legal in one and meaningless in the other,
  because the same string is written into a browser's page margins and into the LaTeX.
  `PRINTOUT_TEXT` allows one line of anything but angle brackets.
- **`Option#hint` is the shape of a good answer, not what happens if you leave it blank.**
  It shows as the field's placeholder, and it lives on the option rather than on the kind
  because the four margin sides accept exactly what "all sides" accepts and *default* to
  something else entirely. Only the first field of the margins row carries one — a side
  reading `0.75in` would name a value that stops being true the moment somebody sets a
  different margin for all sides. `Settings#placeholder_for` prefers the inherited value
  when there is one, so the field shows what is actually in force.

`Option#default_label` names PreTeXt's default where it is a fixed knowable thing ("40
cells"), so an empty number field is usable. It stays nil where PreTeXt derives the default
from the document's own structure — most level options — because naming one there would be
a guess dressed up as information.

Every spelling above was read off
`node_modules/@pretextbook/pretext-html/assets/xsl/publisher-variables.xsl` — the code that
actually consumes them — rather than off the Guide; most of them from the `<pi:publisher>`
table there, which is PreTeXt's own machine-readable list of publication attributes with
their defaults and permitted values. A wrong element name is not an error: PreTeXt silently
falls back to its default, so `test/services/publication_file_builder_test.rb` asserts the
paths.

**A family is not the element path.** `chunk_level` is written under `<common>` but only
HTML honors it; `dark_mode` and `theme` are two attributes of one `<html><css>`. Deriving
the tab from where an option lives in the file would put page size under General and promise
a PDF author something that will not happen — hence the explicit `family`, and a test that
pins the distinction.

Some exclusions and edges:

- The `custom` theme needs an author-supplied `custom-theme.scss`, which this interface
  gives no way to provide, so offering it would only produce failed builds.
- `beamer` is in no family. It runs through the LaTeX conversion, so `<latex>` options
  technically reach it, but page sides on a slide deck means nothing.
- Slideshows appear in no level option: `$numbering-maxlevel` is 0 for a slideshow, it has
  no contents to list, and reveal.js pages itself. A reveal.js output is in no format
  family either, so it gets the General tab and nothing else — and General is never empty,
  because `common/exercise-*` is read in `pretext-common.xsl`, which every conversion
  imports. The modal keeps its "nothing to choose" branch as a guard, but nothing reaches
  it today.
- **Printout headers and footers reach HTML only.** `common/worksheet/@margin` and the four
  sides are read by both `pretext-html.xsl` and `pretext-latex-common.xsl` — the XSL's own
  comment is *"Printout margins. Applies to both PDF and HTML"* — but the twelve
  `$ws-header-*` / `$ws-footer-*` variables are referenced by `pretext-html.xsl` alone,
  which turns them into `data-header-*` attributes for PreTeXt's JavaScript to print. The
  LaTeX conversion sets up no `fancyhdr` for a worksheet. The group still sits under
  General, because margins genuinely do span both and splitting one subject across two tabs
  would be worse; the grid's note says which half a PDF honours.
  twenty attributes directly, one `$entered-exercise-{type}-{part}` variable each, so their
  spellings were read off those variables. Note `exercise-reading`, not
  `exercise-readingquestion`: the knowl attribute for the same kind of exercise is spelled
  the other way, and both spellings are in the catalog because PreTeXt uses both.
- `toc_level` of `0` *is* "no table of contents" — `$b-has-toc` is `$toc-level > 0` — which
  is why it reads as a depth rather than a checkbox plus a depth.
- **A numbering family's level only applies when it has a counter of its own.**
  `pretext-numbers.xsl` reads `$numbering-blocks` for any family that is not `@distinct`,
  so setting `numbering/figures/@level` while figures share the blocks counter changes
  nothing. The group's note says so, because it is the one thing about that table an author
  has to know. `@distinct` is also what decides whether the family gets its own counter at
  all — `pretext-assembly.xsl` folds a non-distinct family's nodes into the blocks counter.
- **The division level *is* the maximum for every other family.** `$numbering-maxlevel` is
  whatever `numbering/divisions/@level` was set to, which is why `NUMBERING_LEVELS` has the
  same range as `DIVISION_NUMBERING_LEVELS` and why both omit slideshows. `DISTINCT_NUMBERING`
  is keyed by document type for the same reason, though nothing forces it to be: with one
  possible level there is no depth to configure, and one live switch in a table of eleven
  blanks reads as breakage rather than as a choice.
- The level maxima come from `$numbering-maxlevel-entered` and the `tableofcontents`
  default template in the same file. PreTeXt clamps anything deeper and logs
  `PTX:FALLBACK`; not offering it beats explaining that afterwards.

## In the archive

`ProjectArchiveBuilder` writes one publication file per target, plus the project's own:

```
project.ptx                      <target … publication="website.ptx"/>
publication/publication.ptx      the project's settings; PreTeXt's fallback name
publication/website.ptx          one per target, resolved through all three levels
publication/print.ptx
```

> **Trap.** `@publication` on a `<target>` resolves relative to the project's *publication
> directory*, not the project root — see `Target.publication_abspath` in
> `PreTeXtBook/pretext-cli`. The attribute is `publication="website.ptx"`;
> `publication="publication/website.ptx"` sends the CLI looking in `publication/publication/`
> and fails every build. `ProjectArchiveBuilder#publication_filename` is the one place that
> spells it, and a test asserts the bare form.

`publication/publication.ptx` is no longer pointed at by anything in the archive — every
target names its own file. It stays because a target added by hand to a downloaded project
lands on it, and should get the project's settings rather than PreTeXt's bare defaults.

`publication` is in `Target::RESERVED_ATTRIBUTES`, so a target's free-form `options` cannot
redirect its own publication file.

Both the build server (`FullBuildJob`) and `projects#download` go through this builder, so a
downloaded project reproduces the same build locally.

## The modal

Four partials — `_modal.html.erb` (the dialog and its tabs), `_group.html.erb` (a
disclosure, as tables or a list), `_option.html.erb` (one labelled control in a panel) and
`_control.html.erb` (the bare input) — for all three levels, served by one
`PublicationSettingsController` that resolves its owner from whichever parent the
path carries. It loads into a `<turbo-frame id="modal">` **in the layout** — not on the
pages that open it — because an output's settings open from inside the target drawer, and a
frame nested in the drawer would be emptied along with it. z-40, above the drawer's z-30.

Entry points: the account page (`users/edit`), the project dashboard beside the Outputs
heading, and the target drawer.

Tabs are `Publication::Catalog.families`, which drops any family with nothing to show —
which is how an output loses the tabs its format does not reach, and how a level reaching
only one family gets that panel with no tab strip above it. `tabs_controller.js` keeps
selection in `aria-selected` and the panels' `hidden`, styled through Tailwind's
`aria-selected:` variant, so there is no class list in JS to keep in step with the markup.

Each panel is one ordered list of `Publication::Settings::Section`s — an option or a
disclosure, interleaved by `Group#after` — so the order is fixed regardless of where a
grouped option happens to sit in `OPTIONS`. `publication_settings_grid` shapes one grid
into rows for its table.

`_control.html.erb` is the input alone — number, text or select — and nothing else. It is
shared so that a setting laid out in a panel and the same setting in a table cell cannot
end up asking for different things; `compact:` is the version for a cell or a group row.

Three things that look like details and are not:

- **Panels are hidden, not unmounted**, and a closed `<details>` is too. Every field
  submits with the form whatever tab is open and whatever is collapsed, so a theme set on
  one tab and a knowl set inside a disclosure on another save together. Unmounting would
  silently drop half of what an author just did.
- `form.select` takes `[label, value]`, the reverse of how the catalog stores choices.
  `Option#select_choices_for` is the single place that flips them; getting it wrong makes
  every option submit its own label, which validation then refuses — a form that looks
  right and cannot be saved.
- `update` **merges** into the stored hash rather than replacing it. The modal offers only
  what the level's document type and output format allow, so a replace would silently drop
  a setting the modal no longer shows (a book converted to an article) for whoever next
  saved something unrelated.

## Not covered

- **Staleness is not tracked.** Changing a setting does not flip an output to "Out of
  date"; it takes effect on the next build. The drawer and the modal both say so.
- The editor's live preview keeps its own styling — it does not honour the theme.
- No free-form publication file editing.

## Unverified against a real build

The XML is asserted against the XSL that consumes it, and the archive layout against the
CLI's own path resolution — but **no build has yet run with a non-default publication
file**. The first `pretext build` on a downloaded project with a theme set is the actual
proof, and the `publication` attribute's relative path is the most likely thing to be wrong.
