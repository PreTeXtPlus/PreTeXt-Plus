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

    # The label an author reads for an inherited value: the option's own wording for it
    # ("A page per section"), not the raw attribute value ("1").
    def inherited_label(option)
      value, source = inherited(option.key)
      return nil if value.nil?

      "#{option.label_for(value, document_type)} (from #{source})"
    end

    # What PreTeXt does when no level has set the option. Deliberately vague about which
    # default that is -- it depends on the document's structure, and guessing in the
    # interface would be worse than saying so.
    def fallback_label
      "PreTeXt's default"
    end

    # What the select's empty choice says, which is: what happens if this level stays
    # silent. Naming the value being inherited, and where it comes from, is what stops an
    # author from setting the same theme at all three levels just to be sure.
    #
    # The account level has nothing above it, so there is nothing to inherit *from* and
    # the word would only confuse.
    def blank_choice_label(option)
      return fallback_label if chain.one?

      "Inherit — #{inherited_label(option) || fallback_label}"
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
      Catalog.for(document_type:, target_kind:)
    end

    # The modal's tabs, as [Family, its options]. Empty when this level has nothing to
    # offer at all -- a reveal.js output of a slideshow, say -- which the modal answers
    # with a sentence rather than an empty dialog.
    def families
      Catalog.families(document_type:, target_kind:)
    end

    def level_name
      LEVELS[owner.class.name]
    end
  end
end
