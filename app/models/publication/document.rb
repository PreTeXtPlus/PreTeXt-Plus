module Publication
  # One level's publication settings (account, project or output), which are stored as
  # publication XML -- a fragment of a PreTeXt publication file holding only what that
  # level sets.
  #
  # The XML is the source of truth, the way an exercise's source is: the build settings
  # modal is an editor over it. `settings` reads out what the modal's controls show, each
  # option from the path its Publication::Catalog entry names; `Document.write` puts a
  # change back at that path and leaves everything else as the author had it. The modal's
  # XML view edits the same text directly, and is how an author reaches anything PreTeXt
  # supports that the modal does not offer -- or pastes a whole publication.ptx from a CLI
  # project.
  #
  # "Inherit" is an attribute that is not there, which is what makes resolving the three
  # levels a merge of their trees: see Publication::Settings#documents and
  # PublicationFileBuilder.
  #
  # The text itself never reaches a build. Only elements, attributes and leaf text are read
  # out of it, and the builder writes a fresh file from those -- so comments, processing
  # instructions and anything namespaced go no further than this class.
  #
  # Three kinds of problem, from most to least serious:
  #
  #   errors   -- the XML is refused and the level keeps what it had: not well formed, a
  #               DOCTYPE, anything namespaced (which is what xi:include is), text where
  #               PreTeXt expects elements, or a file reference that is not a bare filename.
  #   managed  -- saved, but left out of every build, with a warning: the parts of the file
  #               PreTeXt.Plus has to control for a build to work at all (where source and
  #               generated files live, where a site loads its JavaScript from), and the
  #               logo for an account without subscriber benefits.
  #   unknown  -- saved and passed through, with a warning: an element, attribute or value
  #               PreTeXt's XSL does not read (Publication::Schema). Usually a typo; possibly
  #               an option newer than the PreTeXt this app pins.
  class Document
    # Far more than the options in a publication file need -- PreTeXt's own sample is under
    # 4KB -- because authors keep theirs heavily commented, and a pasted file should arrive
    # whole. Still small enough that a paste of the wrong file is caught rather than stored.
    #
    # Enforced here only. A maxlength on the field would enforce it by silently cutting the
    # paste short, which leaves XML that no longer parses and no word about why.
    MAX_LENGTH = 200_000

    Issue = Data.define(:message, :line) do
      def to_s = line ? "Line #{line}: #{message}" : message
      def as_json(*) = { message:, line: }
    end

    # Managed paths, stripped from what a build sees. `nil` as the attribute list means the
    # whole element and everything under it.
    #
    # source/version is the one part of <source> an author may set (it is a modal option,
    # `version`); everything else there names files and directories on the build server.
    MANAGED = {
      %w[ source ] => :except_version,
      %w[ html resources ] => nil,
      %w[ webwork ] => %w[ pg-location ]
    }.freeze

    SUBSCRIBER_ONLY = [ %w[ html brandlogo ] ].freeze

    # Attributes PreTeXt resolves as a file in the external directory. A path here would
    # let a build read whatever is beside the project on the build server into its output,
    # so the value has to be a bare filename, as the modal's own pickers write.
    FILE_ATTRIBUTES = {
      %w[ latex cover ] => %w[ front back ],
      %w[ epub cover ] => %w[ front ],
      %w[ html brandlogo ] => %w[ source ],
      %w[ common qrcode ] => %w[ image ]
    }.freeze

    attr_reader :errors, :warnings

    def initialize(text, subscriber: true)
      @text = text.to_s
      @subscriber = subscriber
      @errors = []
      @warnings = []
      @paths = {}
      parse
    end

    def valid?
      errors.empty?
    end

    # Element path => { attributes: {name => value}, text: String or nil }, with managed
    # parts removed. Empty when the XML was refused, so XML that is invalid but somehow got
    # stored contributes nothing rather than half of itself.
    def paths
      valid? ? @paths : {}
    end

    # What this XML sets at one place: an attribute's value, or the element's text when
    # `attribute` is nil. nil if it says nothing there.
    def value_at(element, attribute)
      node = paths[element]
      return nil if node.nil?

      attribute ? node[:attributes][attribute] : node[:text]
    end

    # What the modal's controls show for this level: our catalog keys => values, for every
    # option this XML sets. A value is whatever the XML holds, permitted or not -- the
    # modal shows one it could not have written as set elsewhere, rather than as unset.
    #
    # An attribute written empty reads as EMPTY_MARKER where the option gives that a
    # meaning (the box beside the field), and as nothing at all where it does not.
    def settings
      @settings ||= Catalog.all.each_with_object({}) do |option, found|
        value = option.text_part? ? text_parts(option.element)[option.part] : value_at(option.element, option.attribute)
        value = Catalog::EMPTY_MARKER if value == "" && option.empty_allowed?

        found[option.key] = value if value.present?
      end
    end

    # The parts of an element's shared text ({part => value}), or {} when it has none or
    # holds something the modal did not write and cannot read.
    def text_parts(element)
      Catalog.text_codec(element)&.parse(value_at(element, nil)) || {}
    end

    # `text` with `changes` applied: {catalog key => value}, where a blank value takes the
    # setting out. Everything else in the XML is kept, comments included; indentation is
    # redone, since a new element has to go somewhere. nil when nothing is left to store.
    #
    # Values are written as given -- deciding what a level may hold is the caller's job
    # (HasPublicationSettings), and Nokogiri escapes whatever arrives. A key the catalog
    # does not know has no path, so it is skipped.
    #
    # Text that will not parse is returned untouched: there is no tree to edit, and the
    # author's typing is worth more than the change.
    def self.write(text, changes)
      xml = begin
        Nokogiri::XML(text.presence || "<publication/>") { |config| config.strict.nonet.noblanks }
      rescue Nokogiri::XML::SyntaxError
        return text
      end
      return text unless xml.root&.name == "publication"

      touched = []
      text_changes = Hash.new { |hash, element| hash[element] = {} }

      changes.to_h.stringify_keys.each do |key, value|
        option = Catalog.find(key)
        next if option.nil?

        touched << option.element
        if option.text_part?
          text_changes[option.element][option.part] = value.presence
        else
          write_attribute(xml, option, value)
        end
      end

      text_changes.each do |element, parts|
        codec = Catalog.text_codec(element)
        node = locate(xml, element, create: true)
        # Starting from what is there, unless that is an author's own text -- which
        # choosing a part in the modal replaces, as the modal says beside the field.
        joined = codec.join((codec.parse(node.text) || {}).merge(parts).compact)
        node.content = joined
      end

      touched.each { |element| prune(xml, element) }
      xml.root.children.empty? ? nil : xml.root.to_xml(indent: 2)
    end

    class << self
      private

        # Set on the first element at the path and removed from any repeats, since a later
        # repeat's attribute would win the merge and quietly undo the change.
        def write_attribute(xml, option, value)
          matches = xml.xpath("/publication/#{option.element.join('/')}")
          matches.each { |node| node.remove_attribute(option.attribute) }
          return if value.blank?

          node = matches.first || locate(xml, option.element, create: true)
          node[option.attribute] = option.written_value(value)
        end

        def locate(xml, element, create: false)
          element.reduce(xml.root) do |parent, name|
            child = parent.element_children.find { |node| node.name == name }
            child ||= parent.add_child(Nokogiri::XML::Node.new(name, xml)) if create
            return nil if child.nil?

            child
          end
        end

        # Removes what a change left hollow, from the element inwards to the root: an
        # element with no attributes, no children and no text says nothing. Only along the
        # path a change touched, so an empty element an author wrote on purpose stays.
        def prune(xml, element)
          element.size.downto(1) do |depth|
            node = locate(xml, element.first(depth))
            break if node.nil?
            break unless node.attribute_nodes.empty? && node.children.all? { |child| child.blank? }

            node.remove
          end
        end
    end

    private

      attr_reader :text

      def parse
        return error("Publication XML is limited to #{MAX_LENGTH / 1000}KB.") if text.length > MAX_LENGTH
        return if text.strip.empty?

        document = begin
          # strict: refuse rather than repair. nonet: never fetch anything. And not NOENT
          # or DTDLOAD, so an entity is never expanded and no DTD is ever read.
          Nokogiri::XML(text) { |config| config.strict.nonet }
        rescue Nokogiri::XML::SyntaxError => e
          return error("This is not well-formed XML: #{e.message.sub(/\A(\d+:\d+: )?((FATAL|ERROR): )?/, '').strip}", e.line)
        end

        if document.internal_subset || document.external_subset
          return error("A DOCTYPE is not allowed here.")
        end

        root = document.root
        unless root&.name == "publication" && root.namespace.nil?
          return error("The outermost element must be <publication>.", root&.line)
        end

        walk(root, [])
      end

      def walk(element, path)
        return unless acceptable_names?(element)

        children = element.element_children
        stray = element.children.select { |node| node.text? || node.cdata? }.map(&:text).join.strip

        if path.any?
          return if managed_element?(element, path)

          node = (@paths[path] ||= { attributes: {}, text: nil })
          note_unknown_element(element, path)
          read_attributes(element, path, node)

          if children.empty?
            node[:text] = stray if stray.present?
          elsif stray.present?
            error("<#{element.name}> holds both text and elements; PreTeXt expects one or the other.",
                  element.line)
          end
        elsif element.attribute_nodes.any? || stray.present?
          error("<publication> itself takes no attributes or text.", element.line)
        end

        seen = Set.new
        children.each do |child|
          if seen.add?(child.name).nil?
            warning("<#{child.name}> appears more than once inside <#{element.name}>; their " \
                    "attributes are merged, and the later one wins where they disagree.", child.line)
          end
          walk(child, path + [ child.name ])
        end
      end

      # Namespaces are refused wholesale: nothing in a publication file uses one, and the
      # thing that would is xi:include.
      def acceptable_names?(element)
        if element.namespace || element.namespace_definitions.any?
          error("<#{element.name}> uses an XML namespace, which is not allowed here.", element.line)
          return false
        end

        namespaced = element.attribute_nodes.find(&:namespace)
        if namespaced
          error("The attribute #{namespaced.name} on <#{element.name}> uses an XML namespace, " \
                "which is not allowed here.", element.line)
          return false
        end

        true
      end

      def read_attributes(element, path, node)
        managed = managed_attributes(path)

        element.attribute_nodes.each do |attribute|
          name = attribute.name
          value = attribute.value

          if managed == :all || managed.include?(name)
            warning("PreTeXt.Plus sets #{name} on <#{element.name}> itself, so this value is ignored.",
                    element.line)
            next
          end

          if FILE_ATTRIBUTES.fetch(path, []).include?(name) && !value.match?(Catalog::EXTERNAL_FILENAME)
            error("#{name} on <#{element.name}> must be the bare filename of a file in this " \
                  "project's assets, like cover.pdf.", element.line)
            next
          end

          note_unknown_attribute(element, path, name, value)
          node[:attributes][name] = value
        end
      end

      # Whether this whole element is one PreTeXt.Plus manages, in which case it is warned
      # about and skipped along with everything inside it.
      def managed_element?(element, path)
        rule = MANAGED[path]
        whole = MANAGED.key?(path) && rule.nil?
        under_source = path.first == "source" && path.size > 1 && path[1] != "version"
        logo = SUBSCRIBER_ONLY.include?(path) && !@subscriber

        if whole || under_source
          warning("PreTeXt.Plus manages <#{path.join('/')}> itself, so this element is ignored.",
                  element.line)
          true
        elsif logo
          warning("A custom logo needs a subscription, so <#{element.name}> is ignored.", element.line)
          true
        else
          false
        end
      end

      # The attributes on this element that PreTeXt.Plus sets itself: all of them on
      # <source>, which names directories and files on the build server; a listed few
      # elsewhere; none on anything else.
      def managed_attributes(path)
        case (rule = MANAGED[path])
        when :except_version then :all
        when Array then rule
        else []
        end
      end

      def note_unknown_element(element, path)
        return if Schema.element?(path)

        warning("PreTeXt does not read <#{path.join('/')}>. Check the spelling against the " \
                "PreTeXt Guide.", element.line)
      end

      def note_unknown_attribute(element, path, name, value)
        unless Schema.attribute?(path, name)
          # An unknown element has already been warned about; one line per mistake.
          if Schema.element?(path)
            warning("PreTeXt does not read #{name} on <#{element.name}>.", element.line)
          end
          return
        end

        options = Schema.options_for(path, name)
        return if options.nil? || options.include?(value)

        warning("#{name} on <#{element.name}> should be one of #{options.join(', ')}; " \
                "PreTeXt will ignore “#{value}”.", element.line)
      end

      def error(message, line = nil)
        @errors << Issue.new(message:, line:)
        nil
      end

      def warning(message, line = nil)
        @warnings << Issue.new(message:, line:)
        nil
      end
  end
end
