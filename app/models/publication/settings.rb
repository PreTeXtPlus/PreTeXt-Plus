module Publication
  # Resolves the three levels an option can be set at into the one value a build uses.
  #
  #   account defaults  ->  project  ->  output (target)
  #
  # Each level overrides the one above it per option, never wholesale: a project that sets
  # only a theme still inherits the account's chunking level. That is exactly Hash#merge,
  # and it stays exactly Hash#merge because HasPublicationSettings never stores a blank --
  # "inherit" is a key that isn't there.
  #
  # Built around a chain rather than three special cases so that the modal, which edits any
  # one of the three, has one thing to ask: what is set here, and what would it be if it
  # weren't?
  class Settings
    # What each level is called where an author reads it. Also the order of the chain.
    LEVELS = {
      "User" => "your account",
      "Project" => "this project",
      "Target" => "this output"
    }.freeze

    # The merged hash a build consumes. The one method the archive builder needs.
    def self.effective_for(owner)
      new(owner).effective
    end

    def initialize(owner)
      @owner = owner
    end

    attr_reader :owner

    # Every level from the account down to and including this one.
    def chain
      @chain ||= case owner
      when Target then [ owner.project.user, owner.project, owner ]
      when Project then [ owner.user, owner ]
      else [ owner ]
      end.compact
    end

    def effective
      @effective ||= chain.reduce({}) { |merged, level| merged.merge(level.publication_settings) }
    end

    # What this level itself sets, if anything -- what the form's select should show as
    # chosen. Distinct from `effective`, which would show an inherited value as though the
    # author had chosen it here, and so turn every "inherit" into an override the first
    # time they saved anything.
    def own(key)
      owner.publication_settings[key.to_s]
    end

    # Whether this level itself has chosen "write the attribute empty" -- the state of the
    # checkbox beside the field, and the reason the field renders blank when it is on: what
    # is stored is a marker standing for the box, not text an author typed.
    def empty_chosen?(option)
      option.empty_allowed? && own(option.key) == Catalog::EMPTY_MARKER
    end

    # What this level's own value puts in a text field, which is nothing when what it holds
    # is the marker. Otherwise the field would show "(none)" as though it were typed, and
    # saving unchanged would turn it into a component by that name.
    def own_text(option)
      own(option.key) unless empty_chosen?(option)
    end

    # What this option would be if this level said nothing: the value and the name of the
    # level it comes from, or nil when nothing above sets it either. This is what lets the
    # blank choice read "Inherit — Salem (from your account)" instead of just "Inherit".
    def inherited(key)
      chain[0...-1].reverse_each do |level|
        value = level.publication_settings[key.to_s]
        return [ value, LEVELS[level.class.name] ] if value.present?
      end
      nil
    end

    # The choices to offer for one option, in this level's context. The single place the
    # modal asks, because two kinds of option cannot answer for themselves: a project's
    # images are not the catalog's to know, and a free number has no list at all.
    def choices_for(option)
      return project_image_choices if option.project_scoped?

      option.choices_for(document_type)
    end

    # The same, in the [label, value] order Rails' select helper takes.
    def select_choices_for(option)
      choices_for(option).map(&:reverse)
    end

    # What a value reads as here. Falls through to the value itself for an image no longer
    # in the project -- better to show the filename that was chosen than to hide that
    # anything is set.
    def label_for(option, value)
      return choices_for(option).to_h[value] || value if option.project_scoped?

      option.label_for(value, document_type)
    end

    # Whether this level shows the option at all. The catalog answers for the document's
    # structure; the part it cannot answer is what a project holds.
    #
    # A project-scoped option turns on having a project, not on the project having
    # anything to offer yet: an author who has never made an EPUB should still find the
    # tab and learn that a cover is a thing they can set -- see unavailable_note, which is
    # what shows in place of an empty picker. The account level has no project at all, and
    # a cover is a particular image in a particular project, so it is genuinely absent
    # there rather than merely empty.
    def offers?(option)
      return false unless option.offered_for?(document_type)
      return project.present? if option.project_scoped?
      # A number to type and words to type are bounded by a range and a pattern, not by a
      # list, so there is nothing here that could come up empty.
      return true unless option.fixed_choices?

      choices_for(option).any?
    end

    # Why an option is showing with no control under it, or nil when it has one. Only the
    # EPUB cover reaches this: the tab earns its place by telling an author the setting
    # exists, and there is nothing to pick until the project has an image to pick.
    def unavailable_note(option)
      return nil unless option.project_scoped? && choices_for(option).empty?

      "Upload an image to this project, and you can choose it here as the cover."
    end

    # The label an author reads for an inherited value: the option's own wording for it
    # ("A page per section"), not the raw attribute value ("1").
    def inherited_label(option)
      value, source = inherited(option.key)
      return nil if value.nil?

      "#{label_for(option, value)} (from #{source})"
    end

    # What PreTeXt does when no level has set the option. Vague unless the option knows
    # better: most defaults follow the document's own structure, and guessing at one in
    # the interface would be worse than saying so. An option that does know says so --
    # "PreTeXt's default (40 cells)" is the difference between an empty number field an
    # author can use and one they cannot.
    def fallback_label(option = nil)
      return "PreTeXt's default" if option&.default_label.blank?

      "#{option.default_note} (#{option.default_label})"
    end

    # What the select's empty choice says, which is: what happens if this level stays
    # silent. Naming the value being inherited, and where it comes from, is what stops an
    # author from setting the same theme at all three levels just to be sure.
    #
    # The account level has nothing above it, so there is nothing to inherit *from* and
    # the word would only confuse.
    def blank_choice_label(option)
      return fallback_label(option) if chain.one?

      "Inherit — #{inherited_label(option) || fallback_label(option)}"
    end

    # The same choice, worded to fit a table cell or a row of a disclosure: the value that
    # takes over, and nothing about where it comes from. Twenty selects across four columns
    # have no room for the sentence, and a select clipped mid-word tells an author less
    # than a short one that is true. The long form goes on the control's title, so hovering
    # still answers "from where?".
    def compact_blank_label(option)
      value, = inherited(option.key)
      reading = value ? label_for(option, value) : option.default_label
      return blank_choice_label(option) if reading.blank?

      chain.one? ? "Default — #{reading}" : "Inherit — #{reading}"
    end

    # What a text field shows while it is empty. The inherited value if there is one, so an
    # author sees what is actually in force; otherwise the shape of a good answer, which is
    # the more useful thing an empty margin field can say. Either way the control's title
    # carries blank_choice_label, which is the sentence neither of these has room for.
    def placeholder_for(option)
      value, = inherited(option.key)

      value.presence || option.hint
    end

    # Narrows what the modal offers. Document type bounds the level options; an output's
    # kind decides whether a theme is worth showing at all. Both are nil at levels that
    # have no such thing, which Catalog.for reads as "do not filter".
    def document_type
      case owner
      when Target then owner.project.document_type
      when Project then owner.document_type
      end
    end

    def target_kind
      owner.kind if owner.is_a?(Target)
    end

    def options
      Catalog.for(document_type:, target_kind:).select { |option| offers?(option) }
    end

    # The modal's tabs, as [Family, its options]. Empty when this level has nothing to
    # offer at all -- a reveal.js output of a slideshow, say -- which the modal answers
    # with a sentence rather than an empty dialog.
    def families
      Catalog.families(document_type:, target_kind:).filter_map do |family, family_options|
        shown = family_options.select { |option| offers?(option) }
        [ family, shown ] if shown.any?
      end
    end

    # One thing a panel lays out: an option on its own, or a group's disclosure with the
    # options it holds.
    Section = Data.define(:option, :group, :options) do
      def self.for_option(option) = new(option:, group: nil, options: nil)
      def self.for_group(group, options) = new(option: nil, group:, options:)

      def group? = !group.nil?
    end

    # A panel's contents in the order they are drawn. One ordered list rather than "the
    # loose options, then the groups", because a group may belong beside the option it
    # elaborates: the numbering table goes under division numbering, which is the setting
    # an author is looking at when they want the rest of it.
    #
    # A group with nothing left to show -- every option in it dropped by document type --
    # is left out rather than rendered as an empty disclosure. So is a group whose anchor
    # this level does not offer: it falls to the end rather than disappearing, since a
    # disclosure with nowhere to sit is still a disclosure an author may want.
    def sections(options)
      loose, grouped = options.partition { |option| option.group.nil? }

      groups = Catalog::GROUPS.values.filter_map do |group|
        shown = grouped.select { |option| option.group == group.key }
        Section.for_group(group, shown) if shown.any?
      end

      anchored = groups.group_by { |section| section.group.after }
      placed = loose.flat_map do |option|
        [ Section.for_option(option), *anchored.delete(option.key) ]
      end

      placed + anchored.values.flatten
    end

    private

      # The project's uploaded images, as [filename, title] -- the filename being the
      # asset's own name in the external directory (Asset#external_filename), which is
      # what PreTeXt resolves an EPUB cover against, and what ProjectArchiveBuilder writes
      # it as.
      #
      # Empty at the account level, which has no project: the cover is a choice among a
      # particular project's images, so there is nothing to default across projects.
      def project_image_choices
        return [] if project.nil?

        project.assets.with_attached_file.filter_map do |asset|
          next unless asset.file.attached? && asset.file.content_type.to_s.start_with?("image/")

          [ asset.external_filename, asset.title.presence || asset.ref ]
        end
      end

      def project
        case owner
        when Target then owner.project
        when Project then owner
        end
      end

    def level_name
      LEVELS[owner.class.name]
    end
  end
end
