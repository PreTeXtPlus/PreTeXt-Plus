module Publication
  # The publisher options an author may set, and the single place that knows how each one
  # is spelled in a PreTeXt publication file.
  #
  # PreTeXt's publication file has scores of options; this offers a curated slice. The
  # point of a catalog rather than hardcoded form fields is that adding one more is one
  # entry here -- the modal, the strong parameters, the validation and the XML writer all
  # read from this list and need no edit of their own.
  #
  # Modeled on Target::Catalog, and for the same reason: the author picks one thing from
  # one list, while the file wants an attribute at a particular path, and only one place
  # should know the translation. If PreTeXt moves an option, that is an edit to `element`
  # here -- no migration, since what we store is our own key and the author's chosen value.
  #
  # Every spelling below was read off
  # node_modules/@pretextbook/pretext-html/assets/xsl/publisher-variables.xsl, which is
  # the code that actually consumes them, rather than off the Guide.
  module Catalog
    # Which outputs an option reaches, and so which tab of the modal it appears in. The
    # two are the same question: an author asking "why did my PDF not change?" is asking
    # which format a setting was for, and a tab per format answers it before they ask.
    #
    # `formats` are Target::Catalog slugs; nil means every output. An option's formats come
    # from its family rather than being listed per option, so the tab an option sits under
    # and the outputs it affects cannot drift apart.
    #
    # Where an option lives in the publication file is unrelated: chunking is written under
    # <common> but only HTML honors it, which is exactly why this is declared rather than
    # derived from the element path.
    Family = Data.define(:key, :label, :note, :formats) do
      def self.build(key, label:, note:, formats: nil)
        new(key: key.to_s, label: label, note: note, formats: formats&.map(&:to_s)&.freeze)
      end

      def affects?(target_kind)
        formats.nil? || formats.include?(target_kind.to_s)
      end
    end

    # Order is the order of the tabs. General leads because it is the one that always
    # applies; an output that is neither web nor print sees only that tab.
    #
    # Beamer is deliberately in no format family. It runs through the LaTeX conversion, so
    # <latex> options technically reach it, but page sides on a slide deck is a setting
    # with no meaning -- and offering it would only invite an author to set it.
    FAMILIES = [
      Family.build(:general, label: "General",
        note: "Applies to every output of this document."),

      # formats: [] rather than nil, so this never shows at the Target level: Catalog.for
      # only consults affects? when target_kind is present, and an empty list matches no
      # target_kind at all. It still shows at the User and Project levels, where
      # target_kind is nil and Catalog.for skips the affects? check entirely -- the live
      # preview belongs to the document being edited, not to any one built output.
      Family.build(:preview, label: "Preview",
        note: "Applies only to the live preview in the editor, not to any built output.",
        formats: []),

      Family.build(:html, label: "HTML",
        note: "Applies to website and SCORM outputs.",
        formats: %w[ website scorm ]),

      Family.build(:pdf, label: "PDF",
        note: "Applies to PDF and LaTeX outputs.",
        formats: %w[ pdf latex ]),

      Family.build(:epub, label: "EPUB",
        note: "Applies to EPUB and Kindle outputs.",
        formats: %w[ epub kindle ]),

      Family.build(:braille, label: "Braille",
        note: "Applies to braille outputs.",
        formats: %w[ braille ])
    ].index_by(&:key).freeze

    # One table inside a group, for the options that really do form a grid -- five kinds of
    # exercise crossed with four components, four printout bands crossed with three
    # positions. The options are generated from the very lists laid out here, joined by
    # `cell_key`, so a cell of the table and the option behind it cannot drift apart.
    #
    # `rows` is optional: a grid with none is a single row of labelled columns and no row
    # headers, which is what the printout margins are. `key_prefix` is what keeps such a
    # grid's keys from being as generic as its columns -- "worksheet_top", not "top".
    Grid = Data.define(:label, :note, :key_prefix, :rows, :columns) do
      def self.build(columns:, label: nil, note: nil, key_prefix: nil, rows: nil)
        new(label: label, note: note, key_prefix: key_prefix&.to_s,
            rows: rows&.freeze, columns: columns.freeze)
      end

      def row_headers?
        rows.present?
      end

      # The rows to draw, as [key, label]. A grid with no rows still has one, unlabelled.
      def row_list
        rows || [ [ nil, nil ] ]
      end

      # Our storage key for one cell. Also what generates that cell's option, which is what
      # keeps the two in step.
      def cell_key(row, column)
        [ key_prefix, row, column ].compact.join("_").tr("-", "_")
      end
    end

    # A set of options shown behind a disclosure rather than laid out in the panel. Every
    # group exists for the same reason: its options are many and alike, and eighteen knowl
    # switches ahead of the theme picker would bury the settings an author came for.
    #
    # `grids` are the tables the group is drawn as, in order; a group with none is a plain
    # list of label-and-control rows, which is what the knowls are. A group may hold more
    # than one, which is what lets printout margins and printout headers share a disclosure
    # while staying two tables with nothing to do with each other's shape.
    #
    # `after` is the key of the loose option the disclosure sits under, for a group that
    # elaborates one particular setting rather than adding a subject of its own -- the rest
    # of the numbering options belong beneath division numbering, which is where an author
    # is standing when they want them. Left nil, a group goes at the foot of its panel.
    Group = Data.define(:key, :label, :note, :family, :grids, :after) do
      def self.build(key, label:, family:, note: nil, grids: [], after: nil)
        new(key: key.to_s, label: label, note: note, family: family.to_s,
            grids: grids.freeze, after: after&.to_s)
      end

      def grids?
        grids.any?
      end
    end

    # `key`       -- our storage key, and the form field name. Ours, not PreTeXt's, so
    #                that an option moving in the publication file is not a data change.
    # `element`   -- path of elements under <publication>, outermost first. nil for an
    #                option with nowhere in the file to live -- the live preview theme,
    #                which PublicationFileBuilder skips for exactly that reason.
    # `attribute` -- the attribute on that element which carries the value. nil along
    #                with `element`.
    # `family`    -- which of FAMILIES it belongs to, which decides both its tab and the
    #                outputs it affects.
    # `group`     -- the GROUPS key it is shown under, or nil to sit in the panel itself.
    # `applied_default` -- a value PreTeXt.Plus writes when nobody sets the option, for
    #                the one case where PreTeXt's own default is not the one we want.
    #                PublicationFileBuilder writes these before author settings merge on
    #                top, so turning one off stays an ordinary setting.
    # An option whose answer is a number rather than one of a list. Braille page geometry
    # is the case that needs it: an embosser's line width is whatever that embosser does,
    # and a dropdown of the handful we happened to think of would be wrong for the next
    # one. PreTeXt asks only for a positive whole number; the bounds here are ours, wide
    # enough for any real embosser and narrow enough that a typo cannot reach a build.
    WholeNumber = Data.define(:min, :max, :unit)

    # An option whose good answers are a shape rather than a list: a printout margin is a
    # length in whatever unit the author thinks in, and a printout header is words of their
    # choosing. Neither has a list we could offer without being wrong about somebody.
    #
    # `pattern` is a security boundary, not a nicety. A margin is interpolated straight
    # into \newgeometry{left=...} in LaTeX that a build server then compiles, so what this
    # permits is the whole of what stands between a text field and that command line.
    # `max_length` bounds it besides, since a pattern that permits any length permits a
    # publication file that is mostly one attribute.
    #
    # What a good answer looks like is the option's `hint`, not the kind's: the four sides
    # of a printout margin accept exactly what "all sides" accepts and default to something
    # else entirely, so one hint for the shape would be wrong about four of the five.
    FreeText = Data.define(:pattern, :max_length)

    # A length both consumers understand. The same string is written into a browser's page
    # margins and into LaTeX's \newgeometry, so the units are the intersection of CSS and
    # TeX -- which rules out px and rem, legal in one and meaningless in the other.
    LENGTH = FreeText.new(pattern: /\A\d+(\.\d+)?(in|cm|mm|pt|pc|em|ex)\z/, max_length: 12)

    # Words for the corner of a printed page. They travel as a data-* attribute that
    # PreTeXt's own JavaScript prints in the margin, so this permits one line of anything
    # but angle brackets -- which cannot be meant in a header and which the value would
    # pass through an HTML attribute carrying.
    PRINTOUT_TEXT = FreeText.new(pattern: /\A[^<>\r\n]*\z/, max_length: 100)

    # An option whose list is the project's own uploaded images -- the EPUB cover, which
    # PreTeXt resolves against the external directory, exactly where ProjectArchiveBuilder
    # writes a project's assets. Publication::Settings builds the list, since the catalog
    # has no project to ask.
    PROJECT_IMAGES = :project_images

    # What an asset is called inside the external directory: ProjectArchiveBuilder writes
    # each one as "<ref><ext>", and `ref` is REF_REGEX. Spelled out rather than composed
    # from REF_REGEX so that what it permits is readable where it is enforced -- and
    # because what matters is what it forbids, which is anything carrying a path.
    EXTERNAL_FILENAME = /\A[a-zA-Z_][a-zA-Z0-9\-_]*\.[a-zA-Z0-9]+\z/

    # `choices`   -- what the option accepts, and so how the modal asks for it:
    #                  Array          -- a fixed list of [value, label]; a select
    #                  Hash           -- those lists keyed by document type, for options
    #                                    bounded by the document's own structure; a select.
    #                                    A type absent from the Hash is one the option is
    #                                    not offered for at all
    #                  WholeNumber    -- any whole number in a range; a number field
    #                  FreeText       -- anything matching a pattern; a text field
    #                  PROJECT_IMAGES -- the project's uploaded images; a select
    # `default_label` -- what PreTeXt does when nobody sets the option, where that is a
    #                fixed knowable thing ("40 cells"). Left nil where PreTeXt derives the
    #                default from the document's own structure, which most level options
    #                do: naming a default that depends on the source would be a guess
    #                dressed up as information.
    # `hint`      -- the shape of a good answer ("0.75in"), for a typed option. Shown as
    #                the field's placeholder, and not the same thing as default_label:
    #                a printout side accepts "0.75in" and defaults to the margin set for
    #                all sides, and a placeholder is the better place for the first.
    Option = Data.define(:key, :label, :help, :element, :attribute, :family, :choices,
                         :default_label, :group, :applied_default, :hint) do
      def self.build(key, label:, family:, choices:, element: nil, attribute: nil,
                     help: nil, default_label: nil, group: nil, applied_default: nil,
                     hint: nil)
        new(key: key.to_s, label: label, help: help,
            element: element&.map(&:to_s)&.freeze, attribute: attribute&.to_s,
            family: family.to_s, choices: choices.freeze,
            default_label: default_label, group: group&.to_s,
            applied_default: applied_default, hint: hint)
      end

      # Whose default takes over when no level has set this, worded for the empty choice.
      # Worth the distinction: PreTeXt ships the embed button off and PreTeXt.Plus writes
      # it on, so "PreTeXt's default" there would name the opposite of what a build does.
      def default_note
        applied_default.present? ? "PreTeXt.Plus default" : "PreTeXt's default"
      end

      # A number to type rather than a list to pick from.
      def free_number?
        choices.is_a?(WholeNumber)
      end

      # Words to type, checked against a shape rather than a list.
      def free_text?
        choices.is_a?(FreeText)
      end

      # A list only a project can supply. Publication::Settings resolves these; everything
      # here would have to guess.
      def project_scoped?
        choices == PROJECT_IMAGES
      end

      def fixed_choices?
        !free_number? && !free_text? && !project_scoped?
      end

      # The [value, label] pairs to offer for a project of this document type, or [] when
      # the option has nothing to offer it -- a slideshow has no divisions to number, and
      # numbering it is not a setting we should pretend exists. Also [] for the two kinds
      # of option this class cannot answer for on its own; see Publication::Settings.
      #
      # Document type is a Project concern, so nil (the account-level modal, which has no
      # project) gets the longest list any type would produce. An account default a given
      # project cannot honor is harmless: PreTeXt clamps an over-deep level to what the
      # document can bear, and that project's own modal will not offer it.
      def choices_for(document_type)
        return [] unless fixed_choices?
        return choices unless choices.is_a?(Hash)
        return choices.values.max_by(&:size) if document_type.nil?

        choices[document_type.to_s] || []
      end

      # The label an option's value reads as, for showing an inherited value as something
      # other than a bare "1". A free number carries its unit, which is the whole
      # difference between "40" and "40 cells".
      def label_for(value, document_type)
        return "#{value} #{choices.unit}" if free_number?

        choices_for(document_type).to_h[value] || value
      end

      # Whether this option accepts the value at all. The single check validation makes,
      # so that the branch over what kind of option this is lives here rather than in the
      # concern that stores them.
      #
      # A fixed-list option is checked against every value it allows for *any* document
      # type: a book that becomes an article keeps its level-4 numbering setting, PreTeXt
      # clamps it, and re-saving something unrelated should not fail on it.
      def permits?(value)
        if free_number?
          value.match?(/\A\d+\z/) && value.to_i.between?(choices.min, choices.max)
        elsif free_text?
          # The margin case is why this is a pattern and not a length check: the value ends
          # up inside \newgeometry{} in LaTeX that a build server compiles.
          value.length <= choices.max_length && value.match?(choices.pattern)
        elsif project_scoped?
          # Not checked against the project's actual assets: this runs on User too, which
          # has no project, and an asset deleted later would otherwise make a level
          # unsaveable. What it does rule out is anything carrying a path.
          value.match?(EXTERNAL_FILENAME)
        else
          values.include?(value)
        end
      end

      # Every value a fixed-list option will accept, across all document types.
      def values
        return [] unless fixed_choices?

        pairs = choices.is_a?(Hash) ? choices.values.flatten(1) : choices
        pairs.map(&:first)
      end

      def family_config
        FAMILIES.fetch(family)
      end

      # Whether an output of this kind is affected by the option -- its family's question,
      # not its own.
      def affects?(target_kind)
        family_config.affects?(target_kind)
      end

      # Whether the document's own structure leaves this option anything to ask about. Only
      # fixed lists are bounded that way -- an embosser's page size and a cover image mean
      # the same thing whatever the document is -- so the other two answer yes and leave
      # the real question (does this project have any images?) to Publication::Settings,
      # which is the only thing holding a project.
      def offered_for?(document_type)
        return true unless fixed_choices?

        choices_for(document_type).any?
      end
    end

    # From $html-theme-option-list in publisher-variables.xsl. Order is the order of the
    # picker, and "default-modern" leads because it is what PreTeXt uses when nothing is
    # set. `custom` is deliberately absent: it requires the author to supply a
    # custom-theme.scss, which this interface gives them no way to do, so offering it
    # would only produce failed builds.
    THEMES = [
      [ "default-modern", "Default-modern" ],
      [ "denver",         "Denver" ],
      [ "tacoma",         "Tacoma" ],
      [ "salem",          "Salem" ],
      [ "greeley",        "Greeley" ],
      [ "boulder",        "Boulder" ]
    ].freeze

    # Chunking is how much of the document goes on one web page, so its labels name the
    # division the split happens at -- which differs by document type. Depth stops at the
    # subsection for both: deeper is legal in the schema but produces a page per paragraph
    # of prose, which is nobody's intent. No slideshow entry -- reveal.js pages itself.
    CHUNK_LEVELS = {
      "book" => [
        [ "0", "Everything on one page" ],
        [ "1", "A page per chapter" ],
        [ "2", "A page per section" ],
        [ "3", "A page per subsection" ]
      ],
      "article" => [
        [ "0", "Everything on one page" ],
        [ "1", "A page per section" ],
        [ "2", "A page per subsection" ]
      ]
    }.freeze

    # How deep division numbers run: level 2 in a book gives "Section 3.4", level 1 gives
    # "Chapter 3" with unnumbered sections inside it.
    #
    # The maxima come from $numbering-maxlevel-entered in publisher-variables.xsl: 4 for a
    # book, 3 for an article with sections, 0 for a slideshow -- which is why a slideshow
    # is not listed. PreTeXt clamps anything deeper and says so in the build log; not
    # offering it beats explaining that message afterwards.
    DIVISION_NUMBERING_LEVELS = {
      "book" => [
        [ "0", "No numbers on divisions" ],
        [ "1", "Number chapters" ],
        [ "2", "Number through sections" ],
        [ "3", "Number through subsections" ],
        [ "4", "Number through sub-subsections" ]
      ],
      "article" => [
        [ "0", "No numbers on divisions" ],
        [ "1", "Number sections" ],
        [ "2", "Number through subsections" ],
        [ "3", "Number through sub-subsections" ]
      ]
    }.freeze

    # Everything else PreTeXt numbers takes a level too, and it means something different
    # from the division level above: it is the depth of the division prefix on the number,
    # and so the division the counter restarts in. Level 2 in a book gives "Theorem 3.4.1"
    # and a fresh count in every section; level 0 gives "Theorem 17" and one run of numbers
    # from cover to cover.
    #
    # The range is the division level's, because it *is* the division level:
    # $numbering-maxlevel in publisher-variables.xsl is whatever numbering/divisions/@level
    # was set to. So a slideshow is absent for the same reason it is absent above -- one
    # possible answer is not a choice -- and PreTeXt clamps anything deeper with a
    # PTX:FALLBACK either way.
    #
    # The default is $default-numbering-level: 2 for a book, 1 for an article with
    # sections, 0 otherwise. Not named as a default_label anywhere below, because it
    # follows the document's own structure, and so does what an author would be told.
    NUMBERING_LEVELS = {
      "book" => [
        [ "0", "Never" ],
        [ "1", "Each chapter" ],
        [ "2", "Each section" ],
        [ "3", "Each subsection" ],
        [ "4", "Each sub-subsection" ]
      ],
      "article" => [
        [ "0", "Never" ],
        [ "1", "Each section" ],
        [ "2", "Each subsection" ],
        [ "3", "Each sub-subsection" ]
      ]
    }.freeze

    # @distinct decides whether a family runs on its own counter or shares the one the
    # blocks use -- and, because pretext-numbers.xsl reads $numbering-blocks for a family
    # that is not distinct, whether that family's own level applies at all. That is the one
    # thing about this table an author has to know, and the group's note says it.
    #
    # Keyed by document type, and so absent for a slideshow, for the same reason the levels
    # are: with $numbering-maxlevel at 0 there is no depth to configure, and one live switch
    # in a table of eleven blanks would read as something broken rather than as a choice.
    DISTINCT_CHOICES = [
      [ "yes", "Its own" ],
      [ "no",  "Shared with blocks" ]
    ].freeze

    DISTINCT_NUMBERING = {
      "book" => DISTINCT_CHOICES,
      "article" => DISTINCT_CHOICES
    }.freeze

    # What PreTeXt numbers, beyond the divisions themselves. `distinct` says whether the
    # family has a @distinct switch at all -- blocks are the counter the others share, and
    # equations and footnotes have counters of their own with nothing to opt out of -- and
    # the last column is what PreTeXt does when @distinct is absent.
    #
    # Projects being the odd one out is real: $b-number-project-distinct is true unless the
    # deprecated debug.project.number parameter is set, and it defaults to empty. The other
    # three default to sharing.
    NUMBERED_FAMILIES = [
      [ "blocks",       "Blocks",                    false, nil ],
      [ "equations",    "Equations",                 false, nil ],
      [ "footnotes",    "Footnotes",                 false, nil ],
      [ "exercises",    "Inline exercises",          true,  "Shared with blocks" ],
      [ "figures",      "Figures, tables, listings", true,  "Shared with blocks" ],
      [ "projects",     "Projects and activities",   true,  "Its own" ],
      [ "openproblems", "Open problems",             true,  "Shared with blocks" ]
    ].freeze

    NUMBERING_COLUMNS = [
      [ "level",    "Numbering restarts" ],
      [ "distinct", "Counter" ]
    ].freeze

    # How much of the document the table of contents lists. Level 0 is no contents at all
    # -- $b-has-toc in publisher-variables.xsl is `$toc-level > 0` -- so this doubles as
    # the switch for having one, which is why it is worded as a depth rather than a
    # checkbox plus a depth.
    #
    # PreTeXt's own default follows the document's structure (2 for a book with sections,
    # 1 for one with only chapters, and so on), so leaving this alone is usually right.
    TOC_LEVELS = {
      "book" => [
        [ "0", "No table of contents" ],
        [ "1", "Chapters only" ],
        [ "2", "Chapters and sections" ],
        [ "3", "Down to subsections" ]
      ],
      "article" => [
        [ "0", "No table of contents" ],
        [ "1", "Sections only" ],
        [ "2", "Sections and subsections" ]
      ]
    }.freeze

    # Every theme in THEMES declares provide-dark-mode, so this is a real choice whichever
    # one is picked. Written as an attribute on html/css alongside the theme itself -- see
    # get-theme-option in publisher-variables.xsl, which reads theme options from there.
    DARK_MODE = [
      [ "yes", "Offer a dark mode" ],
      [ "no",  "Light only" ]
    ].freeze

    # $latex-sides. PreTeXt's default follows the print setting below -- two-sided for
    # print, one-sided for reading on a screen -- so an author who sets that usually need
    # not touch this.
    LATEX_SIDES = [
      [ "one", "Single-sided" ],
      [ "two", "Double-sided" ]
    ].freeze

    # $latex-print. "yes" is the version you send to a printer: it drops the coloring that
    # only means something on a screen, and takes two-sided as its default.
    LATEX_PRINT = [
      [ "no",  "For reading on screen" ],
      [ "yes", "For physical printing" ]
    ].freeze

    # html/@embed-button. PreTeXt's own default is "no"; ours is "yes" -- see the option's
    # applied_default below. A reader who wants a page inside their LMS should not have to
    # hand-write an iframe, and an author who does not want the button can say so.
    EMBED_BUTTON = [
      [ "yes", "Offer an embed button" ],
      [ "no",  "No embed button" ]
    ].freeze

    # What a knowl switch asks, in the two words that answer it. "yes" is the knowled form
    # -- the block is replaced by a link that expands it where the reader is standing.
    KNOWL_CHOICES = [
      [ "yes", "Behind a link" ],
      [ "no",  "Shown in full" ]
    ].freeze

    # Everything under html/knowl, from the pi:publisher table in publisher-variables.xsl.
    # Every one is the same question about a different kind of block, so they are generated
    # from this table rather than written out eighteen times.
    #
    # The third column is PreTeXt's own default, and it genuinely differs per item: proofs,
    # examples and inline exercises are knowled out of the box, everything else is not. It
    # is here so the empty choice can say which -- an author reading "PreTeXt's default"
    # eighteen times learns nothing.
    KNOWLS = [
      [ "theorem",                  "Theorems",                  "no"  ],
      [ "proof",                    "Proofs",                    "yes" ],
      [ "definition",               "Definitions",               "no"  ],
      [ "example",                  "Examples",                  "yes" ],
      [ "example-solution",         "Solutions inside examples", "yes" ],
      [ "project",                  "Projects and activities",   "no"  ],
      [ "task",                     "Tasks within a project",    "no"  ],
      [ "list",                     "Named lists",               "no"  ],
      [ "remark",                   "Remarks",                   "no"  ],
      [ "objectives",               "Objectives",                "no"  ],
      [ "outcomes",                 "Outcomes",                  "no"  ],
      [ "figure",                   "Figures",                   "no"  ],
      [ "table",                    "Tables",                    "no"  ],
      [ "listing",                  "Listings",                  "no"  ],
      [ "exercise-inline",          "Inline exercises",          "yes" ],
      [ "exercise-divisional",      "Divisional exercises",      "no"  ],
      [ "exercise-worksheet",       "Worksheet exercises",       "no"  ],
      [ "exercise-readingquestion", "Reading questions",         "no"  ]
    ].freeze

    # The rows and columns of the exercise-component table: common/exercise-{type}/@{part}.
    # Not in the pi:publisher table -- PreTeXt reads these attributes directly, one
    # $entered-exercise-{type}-{part} variable each -- so the spellings were read off those
    # variables in publisher-variables.xsl.
    #
    # All twenty default to showing. PreTeXt's rule is "unset, or mis-entered, shows the
    # component", so this is a list of things to hide rather than a list to turn on.
    EXERCISE_TYPES = [
      [ "exercise-inline",     "Inline exercises" ],
      [ "exercise-divisional", "Divisional exercises" ],
      [ "exercise-worksheet",  "Worksheet exercises" ],
      [ "exercise-reading",    "Reading questions" ],
      [ "exercise-project",    "Projects and activities" ]
    ].freeze

    EXERCISE_COMPONENTS = [
      [ "statement", "Statement" ],
      [ "hint",      "Hint" ],
      [ "answer",    "Answer" ],
      [ "solution",  "Solution" ]
    ].freeze

    EXERCISE_VISIBILITY = [
      [ "yes", "Show" ],
      [ "no",  "Hide" ]
    ].freeze

    # common/worksheet, from the pi:publisher table. "Printout" is PreTeXt's own word for
    # the pair of divisions these reach -- a worksheet and a handout -- and the XSL says
    # so: "Printout margins. Applies to both PDF and HTML."
    #
    # The four sides are overrides of the fifth: PreTeXt's get-default-pub-variable for
    # each of them returns $ws-margin, so a side left alone is whatever "all sides" is,
    # which is 0.75in until somebody says otherwise. That cascade is PreTeXt's, not ours,
    # and it is why the table puts all five in one row rather than making the author fill
    # in four fields to change one number.
    #
    # The third column is the accessible name for the cell, which the row-header-less table
    # cannot supply from its own headings the way the other grids do. The fourth is what
    # the side falls back to, which is the cascade above and is why only the first names a
    # length.
    PRINTOUT_MARGINS = [
      [ "margin", "All sides", "Margin on all sides", "0.75in" ],
      [ "top",    "Top",       "Top margin",          "whatever “All sides” is" ],
      [ "right",  "Right",     "Right margin",        "whatever “All sides” is" ],
      [ "bottom", "Bottom",    "Bottom margin",       "whatever “All sides” is" ],
      [ "left",   "Left",      "Left margin",         "whatever “All sides” is" ]
    ].freeze

    # common/worksheet/{band}/@{position}. Four bands, three positions, all empty until
    # set. The elements are children of <worksheet>, which is why the band is part of the
    # option's element path rather than of its attribute.
    PRINTOUT_BANDS = [
      [ "first-page-header", "First page header" ],
      [ "running-header",    "Running header" ],
      [ "first-page-footer", "First page footer" ],
      [ "running-footer",    "Running footer" ]
    ].freeze

    PRINTOUT_POSITIONS = [
      [ "left",   "Left" ],
      [ "center", "Center" ],
      [ "right",  "Right" ]
    ].freeze

    # Order is the order the disclosures appear in, under whatever loose options their
    # family holds.
    GROUPS = [
      # Under division numbering rather than at the foot of the panel: this is the rest of
      # the same subject, and the level an author sets here is measured against the one
      # they just set there.
      Group.build(:numbering,
        label: "More numbering options",
        family: :general,
        after: :division_numbering_level,
        note: "Blocks are theorems, definitions, examples, remarks and the like, and they " \
              "share one run of numbers. A family sharing that counter takes its level " \
              "too, so a level of its own only applies once it has a counter of its own.",
        grids: [ Grid.build(key_prefix: :numbering,
                            rows: NUMBERED_FAMILIES.map { |key, label, _, _| [ key, label ] },
                            columns: NUMBERING_COLUMNS) ]),

      Group.build(:exercise_components,
        label: "Exercise components",
        family: :general,
        note: "Which parts of an exercise a reader is shown. This is about the exercise " \
              "where it stands: a solutions section in the back matter is a separate " \
              "thing and is not affected.",
        grids: [ Grid.build(rows: EXERCISE_TYPES, columns: EXERCISE_COMPONENTS) ]),

      # Two tables in one disclosure, because they are one subject to an author and two
      # shapes to a table: five margins in a row, twelve header slots in a grid.
      Group.build(:printout,
        label: "Printout (worksheet and handout) options",
        family: :general,
        # note: "Worksheets and handouts are the two divisions PreTeXt lays out for paper, " \
        #       "and these are their page setup.",
        grids: [
          Grid.build(label: "Margins",
            note: "A length with its unit (e.g. 0.75in, 2cm). A length in a specific side overrides \"All Sides\" for that side.",
            key_prefix: :worksheet,
            columns: PRINTOUT_MARGINS.map { |key, label, _| [ key, label ] }),

          Grid.build(label: "Headers and footers",
            note: "Printed in the corners of the page. (Currently only in the HTML output.)",
            rows: PRINTOUT_BANDS, columns: PRINTOUT_POSITIONS)
        ]),

      Group.build(:knowls,
        label: "Knowls (expandable blocks)",
        family: :html,
        note: "A knowl is content hidden behind a link that expands it in place, so a " \
              "reader can look at a proof or an example without leaving their spot. " \
              "Each kind of block can be shown in full instead.")
    ].index_by(&:key).freeze

    # Every grid's options come from the grid itself, so a cell of a table and the option
    # behind it are one declaration. `grid_of` is how each block below finds the grid it is
    # filling, rather than repeating the key derivation and hoping the two agree.
    def self.grid_of(group, index = 0)
      GROUPS.fetch(group.to_s).grids.fetch(index)
    end

    # Eleven options for seven families, not fourteen: three of them have no @distinct in
    # PreTeXt, and the table leaves those cells empty rather than offering a switch that
    # would be written into the file and ignored.
    NUMBERING_OPTIONS = NUMBERED_FAMILIES.flat_map do |element, label, distinct, shared|
      level = Option.build(grid_of(:numbering).cell_key(element, "level"),
        label: "#{label}, numbering restarts",
        element: [ "numbering", element ], attribute: "level", family: :general,
        group: :numbering, choices: NUMBERING_LEVELS)

      next [ level ] unless distinct

      [ level,
        Option.build(grid_of(:numbering).cell_key(element, "distinct"),
          label: "#{label}, counter",
          element: [ "numbering", element ], attribute: "distinct", family: :general,
          group: :numbering, default_label: shared, choices: DISTINCT_NUMBERING) ]
    end.freeze

    # The twenty exercise-component switches. The label reads as a sentence ("Hint in
    # inline exercises") because nothing else ever sees it: the table's own row and column
    # headers name the cell on screen, and this is what a screen reader and a validation
    # message get.
    EXERCISE_COMPONENT_OPTIONS = EXERCISE_TYPES.flat_map do |element, type_label|
      EXERCISE_COMPONENTS.map do |attribute, component_label|
        Option.build(grid_of(:exercise_components).cell_key(element, attribute),
          label: "#{component_label} in #{type_label.downcase}",
          element: [ "common", element ], attribute: attribute, family: :general,
          group: :exercise_components, default_label: "Show",
          choices: EXERCISE_VISIBILITY)
      end
    end.freeze

    # Only the first field carries the format hint. It shows the shape once for the whole
    # row, and a side showing "0.75in" would be a placeholder naming a value that stops
    # being true the moment somebody types a different margin for all sides.
    PRINTOUT_MARGIN_OPTIONS = PRINTOUT_MARGINS.map do |attribute, _column, label, fallback|
      Option.build(grid_of(:printout).cell_key(nil, attribute),
        label: label,
        element: %w[ common worksheet ], attribute: attribute, family: :general,
        group: :printout, default_label: fallback,
        hint: ("0.75in" if attribute == "margin"),
        choices: LENGTH)
    end.freeze

    PRINTOUT_TEXT_OPTIONS = PRINTOUT_BANDS.flat_map do |element, band_label|
      PRINTOUT_POSITIONS.map do |attribute, position_label|
        Option.build(grid_of(:printout, 1).cell_key(element, attribute),
          label: "#{band_label}, #{position_label.downcase}",
          element: [ "common", "worksheet", element ], attribute: attribute,
          family: :general, group: :printout, default_label: "nothing",
          choices: PRINTOUT_TEXT)
      end
    end.freeze

    KNOWL_OPTIONS = KNOWLS.map do |attribute, label, pretext_default|
      Option.build("knowl_#{attribute.tr('-', '_')}",
        label: label,
        element: %w[ html knowl ], attribute: attribute, family: :html, group: :knowls,
        default_label: KNOWL_CHOICES.to_h[pretext_default],
        choices: KNOWL_CHOICES)
    end.freeze

    # Order within a family is the order of that tab; FAMILIES fixes the order of the tabs
    # themselves. Grouped options may sit anywhere in the list -- the modal shows a
    # family's loose options first and its disclosures after, whatever order they arrive
    # in -- so each block stays next to the constants it was generated from.
    OPTIONS = [
      Option.build(:division_numbering_level,
        label: "Division numbering",
        help: "How deep numbering runs on chapters, sections and subsections.",
        element: %w[ numbering divisions ], attribute: "level", family: :general,
        choices: DIVISION_NUMBERING_LEVELS),

      Option.build(:toc_level,
        label: "Table of contents",
        help: "How much of the document the contents lists.",
        element: %w[ common tableofcontents ], attribute: "level", family: :general,
        choices: TOC_LEVELS),

      *NUMBERING_OPTIONS,
      *EXERCISE_COMPONENT_OPTIONS,
      *PRINTOUT_MARGIN_OPTIONS,
      *PRINTOUT_TEXT_OPTIONS,

      # No element/attribute: this never reaches a publication file. It picks the theme
      # the *editor's* live preview renders with, which PreTeXt.Plus's WASM renderer
      # applies directly rather than through a build -- see PublicationFileBuilder,
      # which skips any option with no element.
      Option.build(:preview_theme,
        label: "Live preview theme",
        help: "The look of the editor's own live preview. Independent of the HTML " \
              "Theme which may be customized for each output.",
        family: :preview,
        choices: THEMES),

      Option.build(:theme,
        label: "Theme",
        help: "The look of a built website: colors, fonts and page furniture.",
        element: %w[ html css ], attribute: "theme", family: :html,
        choices: THEMES),

      Option.build(:dark_mode,
        label: "Dark mode",
        help: "Whether readers can switch the site to a dark color scheme.",
        element: %w[ html css ], attribute: "provide-dark-mode", family: :html,
        choices: DARK_MODE),

      Option.build(:chunk_level,
        label: "Webpage split level",
        help: "How much of the document goes on each web page. PreTeXt calls this chunking.",
        element: %w[ common chunking ], attribute: "level", family: :html,
        choices: CHUNK_LEVELS),

      # The one option PreTeXt.Plus writes a default for. The button hands a reader the
      # snippet that embeds a page in an LMS or another site, which is worth having on by
      # default here and is off in PreTeXt.
      Option.build(:embed_button,
        label: "Embed button",
        help: "Puts a button in the site's toolbar that gives readers the code to embed " \
              "a page in an LMS or another website.",
        element: %w[ html ], attribute: "embed-button", family: :html,
        default_label: "Offer an embed button", applied_default: "yes",
        choices: EMBED_BUTTON),

      *KNOWL_OPTIONS,

      Option.build(:latex_print,
        label: "Intended use",
        help: "A printing PDF drops the link coloring meant for a screen, and is " \
              "double-sided unless you say otherwise below.",
        element: %w[ latex ], attribute: "print", family: :pdf,
        choices: LATEX_PRINT),

      Option.build(:latex_sides,
        label: "Page sides",
        help: "Whether chapters and sections lay out for printing on both sides of a sheet.",
        element: %w[ latex ], attribute: "sides", family: :pdf,
        choices: LATEX_SIDES),

      # $epub-cover-source resolves this against the external directory, which is exactly
      # where ProjectArchiveBuilder writes a project's assets -- so the value is an asset's
      # own "<ref><ext>", and picking one is picking an image already in the project.
      Option.build(:epub_cover,
        label: "Cover image",
        help: "What a reader sees in their library. PreTeXt makes a plain cover if you " \
              "pick nothing; anything you have uploaded to this project can be used instead.",
        element: %w[ epub cover ], attribute: "front", family: :epub,
        choices: PROJECT_IMAGES),

      # $braille-page-width / $braille-page-height. PreTeXt takes any positive whole number
      # and falls back to these defaults with a message; the range is ours, wide enough for
      # any real embosser.
      Option.build(:braille_page_width,
        label: "Cells per line",
        help: "How wide your embosser's page is. 40 suits the usual North American sheet.",
        element: %w[ braille page ], attribute: "width", family: :braille,
        default_label: "40 cells",
        choices: WholeNumber.new(min: 1, max: 100, unit: "cells")),

      Option.build(:braille_page_height,
        label: "Lines per page",
        help: "How tall your embosser's page is. 25 suits the usual North American sheet.",
        element: %w[ braille page ], attribute: "height", family: :braille,
        default_label: "25 lines",
        choices: WholeNumber.new(min: 1, max: 100, unit: "lines"))
    ].index_by(&:key).freeze

    class << self
      def all
        OPTIONS.values
      end

      def keys
        OPTIONS.keys
      end

      # The defaults PreTeXt.Plus writes itself, as [option, value]. Every publication file
      # starts from these; an author's own setting merges over the top, which is what keeps
      # "turn the embed button off" an ordinary option rather than a case in the writer.
      def applied_defaults
        all.filter_map { |option| [ option, option.applied_default ] if option.applied_default.present? }
      end

      # nil for a key the catalog no longer offers, so a setting left behind by a retired
      # option is ignored rather than fatal. HasPublicationSettings drops such keys on the
      # next write.
      def find(key)
        OPTIONS[key.to_s]
      end

      # The options a modal should show, given what it is editing. `document_type` is nil
      # at the account level, where there is no project; `target_kind` is nil at both the
      # account and project levels, where the settings apply to every output.
      def for(document_type: nil, target_kind: nil)
        all.select do |option|
          option.offered_for?(document_type) &&
            (target_kind.nil? || option.affects?(target_kind))
        end
      end

      # The modal's tabs: [Family, its options] in FAMILIES order, with any family that has
      # nothing to show left out entirely.
      #
      # A family empties two ways, and both are worth showing nothing rather than an empty
      # tab: an output that the family does not reach (a PDF has no HTML tab), and a
      # document type that has nothing to configure (a slideshow numbers no divisions).
      def families(document_type: nil, target_kind: nil)
        offered = self.for(document_type:, target_kind:).group_by(&:family)

        FAMILIES.values.filter_map do |family|
          options = offered[family.key]
          [ family, options ] if options.present?
        end
      end
    end
  end
end
