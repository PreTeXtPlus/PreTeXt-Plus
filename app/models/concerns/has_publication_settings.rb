# Everything a User, Project or Target needs to hold one level of publisher options.
# Identical on all three, because the merge that resolves them (Publication::Settings)
# treats the levels identically -- the only difference between a user's settings and a
# target's is where in the chain they sit.
#
# What is stored is publication XML (`publication_xml`): a fragment of a PreTeXt publication
# file holding only what this level sets. "Inherit from the level above" is an attribute
# that is not there. The build settings modal is an editor over that XML, the way an
# exercise's editor is over its source, and `publication_settings` is the modal's view of
# it -- our catalog keys, read out of the XML and written back into it. See
# Publication::Document, which does both.
module HasPublicationSettings
  extend ActiveSupport::Concern

  included do
    # Where these lived before they were XML. Unread; a later migration drops it.
    self.ignored_columns += [ "publication_settings" ]

    # What an author typed, kept as typed, but nil rather than blank so "nothing set here"
    # has one representation.
    normalizes :publication_xml, with: ->(xml) { xml.to_s.strip.empty? ? nil : xml.to_s }

    validate :publication_xml_is_usable
    validate :publication_settings_are_offered
  end

  # This level's XML, parsed -- or nil when there is none. Memoized on the text, since the
  # modal asks once per option and the text only changes on assignment.
  #
  # `subscriber` is the account's at the top of the chain, not this level's owner's, which
  # is why it is passed in (Publication::Settings#subscriber?). It decides only what a
  # build is handed; the default reads everything, which is what the modal shows.
  def publication_document(subscriber: true)
    return nil if publication_xml.blank?

    @publication_documents = {} unless @publication_documents_for == publication_xml
    @publication_documents_for = publication_xml
    @publication_documents[subscriber] ||=
      Publication::Document.new(publication_xml, subscriber:, theme_above: publication_theme_above,
                                                 asset_names: publication_asset_names)
  end

  # The filenames of the project's assets, which this level's file references (a logo, a
  # cover) are checked against -- or nil for an account, whose settings reach every one of
  # its projects and so cannot be checked against any one of them.
  def publication_asset_names
    project = case self
    when Project then self
    when Target then self.project
    end
    return nil if project.nil?

    project.assets.with_attached_files.filter_map(&:external_filename).to_set
  end

  # The HTML theme the nearest level above this one chooses, and that level's name -- what
  # this level builds with when it chooses none itself, and so the theme its own html/css
  # options are checked against (Publication::Document). nil when no level above chooses.
  def publication_theme_above
    levels = Publication::Settings.new(self).chain[0...-1]
    levels.reverse_each do |level|
      theme = level.publication_document&.theme_choice
      return [ theme, Publication::Settings::LEVELS[level.class.name] ] if theme
    end
    nil
  end

  # What this level sets, as the modal sees it: catalog keys => values, read from the XML.
  # Only keys the XML actually holds, which is what keeps resolution a plain Hash#merge.
  def publication_settings
    publication_document&.settings || {}
  end

  # Makes the modal's options exactly these: each one given is written into the XML, and
  # any other the XML held is taken out. Everything else in the XML is left alone.
  #
  # A value the catalog would not offer is not written, and makes the record invalid
  # instead -- so nothing that writes through here, the console included, can put a value
  # in the XML that only the XML view's own rules would have let through.
  def publication_settings=(settings)
    wanted = normalize_publication_settings(settings)
    current = publication_settings

    @unoffered_publication_settings = wanted.reject { |key, value| permitted_setting?(key, value, current) }
    changes = current.keys.index_with { nil }.merge(wanted.except(*@unoffered_publication_settings.keys))
    write_publication_settings(changes.reject { |key, value| current[key] == value })
  end

  # Applies what the modal submitted, without saving, and answers with what it had to
  # refuse as [option, value] pairs.
  #
  # `xml` is this level's XML as the form carried it, when it did and it is usable: the
  # XML view's text, or the copy the settings view holds when it is carrying an edit made
  # in the other view and not yet saved. It replaces the stored XML whole. `submitted` is
  # the settings view's fields -- a value sets an option, a blank takes it out -- and they
  # are applied on top of that XML, or of the stored XML when there is none.
  #
  # Only a field the author changed is written. Every field submits on every save, and
  # writing one they left alone is at best a no-op and at worst destroys something: an
  # empty paper-size field over a geometry the author wrote by hand would otherwise erase
  # it. It is also what lets a value the modal could not have offered survive a save,
  # since no field is drawn for it.
  #
  # "Changed" is against `base`, the XML the fields were drawn from, when the form says
  # what that was -- not against what is stored now. Someone else may have saved this
  # level since the modal opened, and a field still showing what it showed then has not
  # been changed by this author; judged against the stored XML it would look like one
  # that had, and put the old value back over theirs. The changes then land on the
  # stored XML, so whatever else was saved meanwhile is kept.
  #
  # The XML view submits no fields at all, which is what keeps settings that view cannot
  # see from undoing what was typed there.
  def apply_publication_changes(submitted, xml: nil, base: nil)
    self.publication_xml = xml unless xml.nil?
    current = publication_settings
    drawn = base.nil? ? current : Publication::Document.new(base).settings

    changed = normalize_publication_settings(submitted, keep_blank: true)
                .reject { |key, value| drawn[key] == value.presence || current[key] == value.presence }
    refused = changed.select { |key, value| value.present? && !Publication::Catalog.find(key).permits?(value) }

    write_publication_settings(changed.except(*refused.keys))
    refused.map { |key, value| [ Publication::Catalog.find(key), value ] }
  end

  # The same, saved. An author edits every setting of a level in one modal and saves them
  # together, so an all-or-nothing write means one mistyped margin costs them the nine
  # changes they made beside it -- and costs them silently, since the modal is gone by the
  # time they read why. Each value stands or falls on its own instead: the rest is saved,
  # and a refused one keeps whatever this level had before.
  def merge_publication_settings(submitted, xml: nil, base: nil)
    refused = apply_publication_changes(submitted, xml:, base:)

    [ save, refused ]
  end

  private

    def write_publication_settings(changes)
      return if changes.empty?

      self.publication_xml = Publication::Document.write(publication_xml, changes)
    end

    # Catalog keys only, each value read the way it was plainly meant -- which for a length
    # is what turns a typed ".25" into "0.25in". Blanks mean "not set" and are dropped,
    # unless the caller needs them to mean "take this out".
    def normalize_publication_settings(settings, keep_blank: false)
      (settings || {}).to_h.stringify_keys.filter_map do |key, value|
        option = Publication::Catalog.find(key)
        next unless option

        normalized = option.normalize(value)
        [ key, normalized ] if keep_blank || normalized.present?
      end.to_h
    end

    # A value already in the XML is the author's, whoever would have offered it.
    def permitted_setting?(key, value, current)
      current[key] == value || Publication::Catalog.find(key).permits?(value)
    end

    # Only the refusals: warnings are for the author to read, not reasons to lose what they
    # wrote. Subscriber status does not change what is refused -- only what is ignored -- so
    # the check does not need to know it.
    def publication_xml_is_usable
      document = publication_document
      return if document.nil? || document.valid?

      document.errors.each { |issue| errors.add(:publication_xml, issue.to_s) }
    end

    # Values are written into a publication file that a build server then runs, so what
    # arrives as a setting is checked against the catalog rather than merely escaped on the
    # way out. Publication::Catalog::Option#permits? owns what each kind of option will
    # accept -- a list, a number in a range, or a bare filename.
    def publication_settings_are_offered
      (@unoffered_publication_settings || {}).each do |key, value|
        option = Publication::Catalog.find(key)
        errors.add(:publication_settings, "has no #{option.label.downcase} of “#{value}”")
      end
    end
end
