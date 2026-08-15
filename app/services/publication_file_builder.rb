# Turns a resolved set of publisher options (see Publication::Settings) into a PreTeXt
# publication file.
#
# Two things go into every file it writes. BASE is what the build has always needed and no
# author chooses: where external assets and generated assets live, and that HTML resources
# come from the CDN. On top of that go the author's own choices, each written as an
# attribute at the path its Publication::Catalog entry names.
#
# Values are checked against the catalog on write (HasPublicationSettings) and escaped
# here, so neither an unknown option nor an unexpected value can reach the build server.
class PublicationFileBuilder
  # The elements the build depends on, as element path => attributes.
  #
  # source/directories: the archive puts assets in source/external, which is where PreTeXt
  # resolves `external` relative to the main source file. html/resources: the built site
  # loads its JavaScript and CSS from the PreTeXt CDN rather than carrying its own copy.
  # html/brandlogo: every build gets a brandlogo pointed at the archive's icon.svg --
  # ProjectArchiveBuilder writes that path whenever a project has no uploaded icon of its
  # own (see its icon_asset fallback), matching what default_docs/docinfo.xml used to set.
  #
  # Author options merge *onto* this, so an option may extend one of these elements (a
  # theme lands on html/css, alongside html/resources) but the attributes here are not
  # something the catalog can offer, and nothing above can drop them.
  #
  # Not the same thing as Publication::Catalog.applied_defaults, which is also written into
  # every file: those *are* the catalog's to offer, and an author who turns the embed
  # button off overrides one. Anything an author may change belongs there, not here.
  BASE = {
    %w[ source directories ] => { "external" => "external", "generated" => "generated" },
    %w[ html resources ] => { "host" => "cdn" },
    %w[ html brandlogo ] => { "source" => "icon.svg" }
  }.freeze

  # `settings` is the merged hash from Publication::Settings -- our own keys, not PreTeXt's.
  def initialize(settings)
    @settings = (settings || {}).stringify_keys
  end

  def to_xml
    Nokogiri::XML::Builder.new(encoding: "UTF-8") { |xml| xml.publication { build_tree(xml, tree) } }
      .to_xml(indent: 2)
  end

  private

    attr_reader :settings

    # Element path => attributes, with the author's choices merged onto what every file
    # starts from. Nested rather than flat because two options may share an ancestor (a
    # theme and a page size both live under <html>), and the file has to nest them under
    # one element.
    def attributes_by_path
      settings.each_with_object(starting_attributes) do |(key, value), paths|
        option = Publication::Catalog.find(key)
        next if option.nil?

        # written_value, not value: an option may be set to "write this attribute empty",
        # which our storage holds as a marker because a blank setting already means
        # "inherit". See Publication::Catalog::EMPTY_MARKER.
        (paths[option.element] ||= {})[option.attribute] = option.written_value(value)
      end
    end

    # BASE, plus a value for each option PreTeXt.Plus defaults differently from PreTeXt.
    # Written as ordinary attributes so the author's settings, merging next, simply
    # overwrite them -- turning the embed button off is a setting, not a special case.
    def starting_attributes
      Publication::Catalog.applied_defaults
        .each_with_object(BASE.transform_values(&:dup)) do |(option, value), paths|
          (paths[option.element] ||= {})[option.attribute] = value
        end
    end

    # A nested Hash of element name => [children, attributes], so that
    # `html/css/@theme` and `html/resources/@host` come out as one <html> holding two
    # elements rather than two <html> elements holding one each -- which PreTeXt reads as
    # only the first.
    def tree
      attributes_by_path.each_with_object({}) do |(path, attributes), root|
        node = path.reduce(root) { |level, name| level[name] ||= {} }
        node[:attributes] = (node[:attributes] || {}).merge(attributes)
      end
    end

    # Element names come straight out of the catalog as strings (some hyphenated, like
    # "first-page-header"), so #send rather than a literal method call -- Builder's own
    # method_missing dispatches either way, and #send is the only one that can carry a
    # name Ruby method syntax can't spell.
    def build_tree(xml, node)
      node.except(:attributes).each do |name, child|
        xml.send(name, child[:attributes] || {}) { build_tree(xml, child) }
      end
    end
end
