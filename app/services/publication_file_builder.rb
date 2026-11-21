# Turns a resolved set of publisher options (see Publication::Settings) into a PreTeXt
# publication file.
#
# Two things go into every file it writes. BASE is what the build has always needed and no
# author chooses: where external assets and generated assets live, and that HTML resources
# come from the CDN. On top of that go the author's own choices: each level's publication
# XML (Publication::Document), merged from the account down.
#
# The file is written fresh from elements, attributes and text read out of those documents,
# and escaped here, so nothing else an author typed can reach the build server.
class PublicationFileBuilder
  # The elements the build depends on, as element path => attributes.
  #
  # source/directories: generated images go in generated-assets/, beside source/ -- the
  # layout PreTeXt authors are told to keep; the path is relative to the main source
  # file, hence the "../". The *external* directory (assets/, also beside source/) is not
  # here: PreTeXt reads it from the docinfo now (directories/@external, 2026-07-30), where
  # the assembler writes it (archiveDocinfo in railsProjectMapping.js), and warns when a
  # publication file names it too. html/resources: the built site
  # loads its JavaScript and CSS from the PreTeXt CDN rather than carrying its own copy.
  # html/brandlogo: every build gets the PreTeXt.Plus logo, which ProjectArchiveBuilder
  # writes to DEFAULT_BRANDLOGO. It sits in a directory of its own because assets are
  # written as bare "<ref>.<ext>" beside it, and a ref cannot hold a "/" -- so no upload,
  # not even one called "icon", can stand in for it. The logo links to
  # DEFAULT_BRANDLOGO_URL. A subscriber's chosen logo and link (the brandlogo and
  # brandlogo_url options) merge over both.
  #
  # Author options merge *onto* this, so an option may extend one of these elements (a
  # theme lands on html/css, alongside html/resources) but the attributes here are not
  # something the catalog can offer, and nothing above can drop them.
  #
  # Not the same thing as Publication::Catalog.applied_defaults, which is also written into
  # every file: those *are* the catalog's to offer, and an author who turns the embed
  # button off overrides one. Anything an author may change belongs there, not here.
  DEFAULT_BRANDLOGO = "pretext-plus/icon.svg".freeze
  DEFAULT_BRANDLOGO_URL = "https://pretext.plus".freeze

  BASE = {
    %w[ source directories ] => { "generated" => "../generated-assets" },
    %w[ html resources ] => { "host" => "cdn" },
    %w[ html brandlogo ] => { "source" => DEFAULT_BRANDLOGO, "url" => DEFAULT_BRANDLOGO_URL }
  }.freeze

  # The paths of BASE no author may change, in the modal or in the XML.
  MANAGED = [ %w[ source directories ], %w[ html resources ] ].freeze

  # `documents` is one Publication::Document per level, from the account down
  # (Publication::Settings#documents); a level that sets nothing may be nil. Callers
  # holding a hash of settings instead -- our keys, as the modal reads them, which is most
  # tests -- may pass that, and it is read as the one level that would store them.
  #
  # `default_logo: false` leaves out the PreTeXt.Plus logo BASE points every build at. That
  # file is one ProjectArchiveBuilder writes into a build's archive; anything rendering
  # without an archive -- the editor's live preview -- would be pointing at an image that
  # is not there. A logo an author chose is an asset of the project and is unaffected.
  def initialize(documents, default_logo: true)
    @documents = documents.is_a?(Hash) ? [ self.class.document_for(documents) ] : documents.compact
    @default_logo = default_logo
  end

  def self.for(owner, **options)
    new(Publication::Settings.new(owner).documents, **options)
  end

  def self.document_for(settings)
    Publication::Document.new(Publication::Document.write(nil, settings))
  end

  def to_xml
    Nokogiri::XML::Builder.new(encoding: "UTF-8") { |xml| xml.publication { build_tree(xml, tree) } }
      .to_xml(indent: 2)
  end

  private

    attr_reader :documents

    # Element path => { attributes, text }: what every file starts from, then each level's
    # XML over it, from the account down -- so a level overrides the one above it an
    # attribute at a time. Keyed by path rather than nested because two settings may share
    # an ancestor (a theme and a logo both live under <html>), and merging is per element.
    #
    # The managed part of BASE goes on last as well as first. First, so it sits where an
    # author expects it in the file; last, so that nothing a level wrote can move it -- the
    # document strips these paths already, but they are what a build depends on. Not the
    # logo, which BASE only defaults and a subscriber's choice is meant to replace.
    def nodes
      merged = merge_nodes!({}, starting_nodes)
      text_parts = {}

      documents.each do |document|
        merge_nodes!(merged, document.paths)
        compose_shared_text!(merged, document, text_parts)
      end

      merge_nodes!(merged, base_nodes.slice(*MANAGED))
    end

    def merge_nodes!(into, from)
      from.each do |path, node|
        target = (into[path] ||= { attributes: {}, text: nil })
        target[:attributes].merge!(node[:attributes] || {})
        target[:text] = node[:text] unless node[:text].nil?
      end
      into
    end

    # Text that several options share (LaTeX page geometry) merges by part, not wholesale:
    # a margin an output sets is written together with the paper size its project chose.
    # Each level stores only its own parts; this gathers them and writes the composed
    # string a build needs -- see Publication::Catalog::Geometry.compose for why that is
    # more than joining them.
    #
    # A level whose text is not made of those parts wrote its own, and that is taken as
    # written: it stands as the element's text (merge_nodes! put it there) and the parts
    # gathered so far are forgotten, since it replaced them.
    def compose_shared_text!(merged, document, text_parts)
      Publication::Catalog::TEXT_CODECS.each do |element, codec|
        next if document.value_at(element, nil).nil?

        parts = document.text_parts(element)
        if parts.empty?
          text_parts.delete(element)
        else
          text_parts[element] = (text_parts[element] || {}).merge(parts)
          merged[element][:text] = codec.compose(text_parts[element])
        end
      end
    end

    def base_nodes
      base = @default_logo ? BASE : BASE.except(%w[ html brandlogo ])
      base.transform_values { |attributes| { attributes: attributes.dup, text: nil } }
    end

    # BASE, plus a value for each option PreTeXt.Plus defaults differently from PreTeXt.
    # Written as ordinary attributes so a level's XML, merging next, simply overwrites
    # them -- turning the embed button off is a setting, not a special case.
    def starting_nodes
      Publication::Catalog.applied_defaults.each_with_object(base_nodes) do |(option, value), paths|
        (paths[option.element] ||= { attributes: {}, text: nil })[:attributes][option.attribute] = value
      end
    end

    # A nested Hash of element name => children, with :node holding the element's own
    # attributes and text, so that `html/css/@theme` and `html/resources/@host` come out as
    # one <html> holding two elements rather than two <html> elements holding one each --
    # which PreTeXt reads as only the first.
    def tree
      nodes.each_with_object({}) do |(path, node), root|
        level = path.reduce(root) { |parent, name| parent[name] ||= {} }
        level[:node] = node
      end
    end

    # Element names are strings out of parsed XML (some hyphenated, like
    # "first-page-header"), so #send rather than a literal method call -- Builder's own
    # method_missing dispatches either way, and #send is the only one that can carry a
    # name Ruby method syntax can't spell.
    #
    # Text is written only on an element with no children: PreTeXt has no mixed content in
    # a publication file, and Document refuses it on the way in.
    def build_tree(xml, level)
      level.except(:node).each do |name, child|
        node = child[:node] || {}
        attributes = node[:attributes] || {}
        children = child.except(:node)

        if children.empty? && node[:text]
          xml.send(name, node[:text], attributes)
        else
          xml.send(name, attributes) { build_tree(xml, child) }
        end
      end
    end
end
