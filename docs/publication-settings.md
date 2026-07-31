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

| Key | Family | Publication path | Values |
|---|---|---|---|
| `division_numbering_level` | General | `numbering/divisions/@level` | book `0`–`4`, article `0`–`3` |
| `toc_level` | General | `common/tableofcontents/@level` | book `0`–`3`, article `0`–`2` |
| `theme` | HTML | `html/css/@theme` | `default-modern` (PreTeXt's default), `denver`, `tacoma`, `salem`, `greeley`, `boulder` |
| `dark_mode` | HTML | `html/css/@provide-dark-mode` | `yes` (PreTeXt's default), `no` |
| `chunk_level` | HTML | `common/chunking/@level` | book `0`–`3`, article `0`–`2` |
| `latex_print` | PDF | `latex/@print` | `no` (PreTeXt's default), `yes` |
| `latex_sides` | PDF | `latex/@sides` | `one`, `two` |

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
  no contents to list, and reveal.js pages itself. A reveal.js output therefore has nothing
  on offer at all, and the modal says so instead of showing an empty form.
- `toc_level` of `0` *is* "no table of contents" — `$b-has-toc` is `$toc-level > 0` — which
  is why it reads as a depth rather than a checkbox plus a depth.
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

One partial, `app/views/publication_settings/_modal.html.erb`, for all three levels, served
by one `PublicationSettingsController` that resolves its owner from whichever parent the
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

Three things that look like details and are not:

- **Panels are hidden, not unmounted.** Every field submits with the form whatever tab is
  open, so a theme set on one tab and page sides set on another save together. Unmounting
  would silently drop half of what an author just did.
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
