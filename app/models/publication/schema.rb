module Publication
  # What PreTeXt reads from a publication file: the element paths it looks at, the
  # attributes on each, and -- where PreTeXt says -- the values each accepts.
  #
  # Used for one thing: warning an author whose publication XML (Publication::Document)
  # names something PreTeXt will not read. A misspelled attribute in a publication file is
  # not an error anywhere -- PreTeXt silently uses its default -- so without this an author
  # learns about the typo by staring at a PDF that did not change.
  #
  # Never a reason to refuse. The list is generated from the XSL this app pins (see
  # `bin/rails pretext:publication_schema`), and an author following a newer PreTeXt Guide
  # than that pin may well know an option we do not.
  module Schema
    SOURCE = Rails.root.join("config/pretext_publication_schema.yml")

    class << self
      # Whether PreTeXt reads this element (a path of names under <publication>), or one
      # beneath it.
      def element?(path)
        key = path.join("/")
        prefixes.include?(key)
      end

      def attribute?(path, name)
        attributes(path).key?(name)
      end

      # The values PreTeXt accepts for an attribute, or nil where it takes anything (or we
      # do not know).
      def options_for(path, name)
        attributes(path).dig(name, "options")
      end

      def default_for(path, name)
        attributes(path).dig(name, "default")
      end

      private

        def attributes(path)
          paths.fetch(path.join("/"), {})
        end

        # The generated table, plus every path the catalog writes. Some of the catalog's
        # are read in ways the generator's literal-path scan cannot see (html/css/@theme is
        # looked up through a template), and an option the modal itself offers is not
        # something to warn about when written by hand.
        def paths
          @paths ||= begin
            table = YAML.load_file(SOURCE).fetch("paths").transform_values(&:dup)
            Catalog.all.each do |option|
              entry = (table[option.element.join("/")] ||= {})
              entry[option.attribute] ||= {} if option.attribute
            end
            table.freeze
          end
        end

        def prefixes
          @prefixes ||= paths.keys.flat_map do |key|
            parts = key.split("/")
            parts.each_index.map { |i| parts[0..i].join("/") }
          end.to_set.freeze
        end
    end
  end
end
