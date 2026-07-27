class Target
  # The list of outputs an author picks from, and the single place that knows how each
  # one is spelled in project.ptx.
  #
  # PreTeXt's manifest decomposes some outputs across two attributes -- a SCORM package
  # is `format="html" compression="scorm"`, not a format of its own -- while an author
  # picks one thing from one list ("a website", "a SCORM package"). A Kind is one item in
  # that list: the author-facing concept, plus `emits`, which is how the concept lands in
  # the manifest.
  #
  # Targets store their kind and derive the decomposition, never the reverse. If PreTeXt
  # promotes SCORM to a real format, or renames `compression`, that is an edit to `emits`
  # here -- no migration, and no data change across the rows that already used it.
  #
  # It also makes illegal combinations unrepresentable rather than validated-against:
  # there is no way to spell "a PDF compressed as scorm", because no kind emits it.
  module Catalog
    Kind = Data.define(:slug, :label, :emits, :site, :viewable, :filename_ext, :extensions,
                       :document_types) do
      # Defaults live here rather than at each call site: most kinds are a single
      # downloadable file available to every document type, and say so by omission.
      #
      # `viewable` is whether opening the artifact in a browser means anything. A PDF or
      # a reveal.js deck is worth opening; a SCORM package or an EPUB is a container you
      # feed to something else, and offering to "open" it just downloads it with extra
      # steps. Every site is viewable by definition, so `site` implies it.
      def self.build(slug, label:, emits:, site: false, viewable: false, filename_ext: nil,
                     extensions: [], document_types: nil)
        new(slug: slug.to_s, label: label, emits: emits.freeze, site: site,
            viewable: site || viewable, filename_ext: filename_ext,
            extensions: extensions.freeze,
            document_types: document_types&.map(&:to_s)&.freeze)
      end

      # nil means "every document type"; a list means only those. PreTeXt can only make
      # slides out of a <slideshow>, so offering them elsewhere would queue a build that
      # cannot succeed.
      def available_for?(document_type)
        document_types.nil? || document_types.include?(document_type.to_s)
      end

      def restricted?
        !document_types.nil?
      end
    end

    # Order is the order of the picker.
    #
    # `emits` keys are project.ptx attribute names spelled exactly as the schema spells
    # them -- strings, hyphenated -- so they merge cleanly with a target's `options`
    # jsonb, which comes back from the database with string keys too.
    #
    # `filename_ext` is set only where the schema allows @output-filename (pdf, latex,
    # epub, kindle, revealjs), which makes the artifact's path known before the build
    # runs. Everything else discovers its entry file afterwards from `extensions`.
    # Beamer is deliberately left to discovery: it produces a PDF, but whether the schema
    # accepts @output-filename on it is unverified, and guessing wrong fails every build
    # of that target with a manifest error.
    #
    # PreTeXt's schema also has `webwork` and `custom` formats. Neither is a coherent
    # author-facing choice on its own -- `custom` means nothing without an @xsl -- so
    # neither is in the catalog.
    KINDS = [
      Kind.build(:website, label: "Website",
        emits: { "format" => "html" },
        site: true, extensions: %w[ .html ]),

      Kind.build(:website_zip, label: "Website (zip download)",
        emits: { "format" => "html", "compression" => "zip" },
        extensions: %w[ .zip ]),

      Kind.build(:scorm, label: "SCORM package (for an LMS)",
        emits: { "format" => "html", "compression" => "scorm" },
        extensions: %w[ .zip ]),

      Kind.build(:pdf, label: "PDF",
        emits: { "format" => "pdf" },
        viewable: true, filename_ext: "pdf", extensions: %w[ .pdf ]),

      Kind.build(:epub, label: "EPUB",
        emits: { "format" => "epub" },
        filename_ext: "epub", extensions: %w[ .epub ]),

      Kind.build(:kindle, label: "Kindle",
        emits: { "format" => "kindle" },
        filename_ext: "epub", extensions: %w[ .epub .mobi ]),

      Kind.build(:braille, label: "Braille",
        emits: { "format" => "braille" },
        extensions: %w[ .brf .txt ]),

      Kind.build(:revealjs, label: "Slides (reveal.js)",
        emits: { "format" => "revealjs" },
        viewable: true, filename_ext: "html", extensions: %w[ .html ],
        document_types: %i[ slideshow ]),

      Kind.build(:beamer, label: "Slides (Beamer PDF)",
        emits: { "format" => "beamer" },
        viewable: true, extensions: %w[ .pdf ], document_types: %i[ slideshow ]),

      Kind.build(:latex, label: "LaTeX source",
        emits: { "format" => "latex" },
        filename_ext: "tex", extensions: %w[ .tex ])
    ].index_by(&:slug).freeze

    class << self
      def all
        KINDS.values
      end

      def slugs
        KINDS.keys
      end

      # nil for an unknown slug, so callers can render a half-broken row rather than
      # raise. The inclusion validation on Target is what keeps unknown slugs out.
      def find(slug)
        KINDS[slug.to_s]
      end

      # The kinds a project of this document type may add, in catalog order.
      def for_document_type(document_type)
        all.select { |kind| kind.available_for?(document_type) }
      end
    end
  end
end
