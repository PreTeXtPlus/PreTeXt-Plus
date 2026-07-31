module Publication
  # The publisher options an author may set, and the single place that knows how each one
  # is spelled in a PreTeXt publication file.
  #
  # PreTeXt's publication file has scores of options; this offers three. The point of a
  # catalog rather than three hardcoded form fields is that adding a fourth is one entry
  # here -- the modal, the strong parameters, the validation and the XML writer all read
  # from this list and need no edit of their own.
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

      Family.build(:html, label: "HTML",
        note: "Applies to website and SCORM outputs.",
        formats: %w[ website scorm ]),

      Family.build(:pdf, label: "PDF",
        note: "Applies to PDF and LaTeX outputs.",
        formats: %w[ pdf latex ])
    ].index_by(&:key).freeze

    # `key`       -- our storage key, and the form field name. Ours, not PreTeXt's, so
    #                that an option moving in the publication file is not a data change.
    # `element`   -- path of elements under <publication>, outermost first.
    # `attribute` -- the attribute on that element which carries the value.
    # `family`    -- which of FAMILIES it belongs to, which decides both its tab and the
    #                outputs it affects.
    # `choices`   -- [value, label] pairs. A bare array when every document type gets the
    #                same list, or a Hash keyed by document type when the list depends on
    #                the document's own structure, which the level options do. A type
    #                absent from that Hash is a type the option is not offered for.
    Option = Data.define(:key, :label, :help, :element, :attribute, :family, :choices) do
      def self.build(key, label:, element:, attribute:, family:, choices:, help: nil)
        new(key: key.to_s, label: label, help: help, element: element.map(&:to_s).freeze,
            attribute: attribute.to_s, family: family.to_s, choices: choices.freeze)
      end

      # The [value, label] pairs to offer for a project of this document type, or [] when
      # the option has nothing to offer it -- a slideshow has no divisions to number, and
      # numbering it is not a setting we should pretend exists.
      #
      # Document type is a Project concern, so nil (the account-level modal, which has no
      # project) gets the longest list any type would produce. An account default a given
      # project cannot honor is harmless: PreTeXt clamps an over-deep level to what the
      # document can bear, and that project's own modal will not offer it.
      def choices_for(document_type)
        return choices unless choices.is_a?(Hash)
        return choices.values.max_by(&:size) if document_type.nil?

        choices[document_type.to_s] || []
      end

      # The same choices in the order Rails' select helper takes them, which is [label,
      # value] -- the reverse of how they are written here. Written [value, label] because
      # that is the direction everything else reads them in (looking a stored value's
      # label up), and flipped in exactly this one place rather than storing them
      # backwards to suit one helper.
      def select_choices_for(document_type)
        choices_for(document_type).map(&:reverse)
      end

      # The label an option's value reads as, for showing an inherited value as something
      # other than a bare "1".
      def label_for(value, document_type)
        choices_for(document_type).to_h[value] || value
      end

      # Every value this option will accept, across all document types. What validation
      # checks against: the modal already filters by document type, so anything here is a
      # value some project could legitimately have chosen.
      def values
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

      def offered_for?(document_type)
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

    # Order within a family is the order of that tab; FAMILIES fixes the order of the tabs
    # themselves.
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
        choices: LATEX_SIDES)
    ].index_by(&:key).freeze

    class << self
      def all
        OPTIONS.values
      end

      def keys
        OPTIONS.keys
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
