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
  #
  # Author options merge *onto* this, so an option may extend one of these elements (a
  # theme lands on html/css, alongside html/resources) but the attributes here are not
  # something the catalog can offer, and nothing above can drop them.
  BASE = {
    %w[ source directories ] => { "external" => "external", "generated" => "generated" },
    %w[ html resources ] => { "host" => "cdn" }
  }.freeze

  # `settings` is the merged hash from Publication::Settings -- our own keys, not PreTeXt's.
  def initialize(settings)
    @settings = (settings || {}).stringify_keys
  end

  def to_xml
    <<~XML
      <?xml version="1.0" encoding="UTF-8"?>
      <publication>
      #{render_tree(tree).chomp}
      </publication>
    XML
  end

  private

    attr_reader :settings

    # Element path => attributes, with the author's choices merged onto BASE. Nested
    # rather than flat because two options may share an ancestor (a theme and a page size
    # both live under <html>), and the file has to nest them under one element.
    def attributes_by_path
      settings.each_with_object(BASE.transform_values(&:dup)) do |(key, value), paths|
        option = Publication::Catalog.find(key)
        next if option.nil?

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

    def render_tree(node, depth = 1)
      node.except(:attributes).map do |name, child|
        indent = "  " * depth
        attributes = format_attributes(child[:attributes])
        nested = render_tree(child, depth + 1)

        if nested.empty?
          "#{indent}<#{name}#{attributes}/>\n"
        else
          "#{indent}<#{name}#{attributes}>\n#{nested}#{indent}</#{name}>\n"
        end
      end.join
    end

    def format_attributes(attributes)
      return "" if attributes.blank?

      attributes.map { |name, value| %( #{name}="#{ERB::Util.html_escape(value)}") }.join
    end
end
