# Everything a User, Project or Target needs to hold one level of publisher options.
# Identical on all three, because the merge that resolves them (Publication::Settings)
# treats the levels identically -- the only difference between a user's settings and a
# target's is where in the chain they sit.
#
# The column holds only keys the author actually chose. "Inherit from the level above" is
# the *absence* of a key, which is what makes resolution a plain Hash#merge and what makes
# clearing an override possible: the form submits an empty value and the key goes away.
module HasPublicationSettings
  extend ActiveSupport::Concern

  included do
    # Blank values mean "inherit", and keys the catalog no longer offers mean nothing at
    # all, so neither is worth storing. What is left is put in the form the option stores it
    # in, which for a length is what turns a typed ".25" into "0.25in". Doing all of it here
    # rather than in the controller keeps the column clean whatever writes to it --
    # including Project#full_dup, which copies attributes wholesale, and the console.
    normalizes :publication_settings, with: ->(settings) do
      (settings || {}).to_h.stringify_keys.filter_map do |key, value|
        option = Publication::Catalog.find(key)
        next unless option

        normalized = option.normalize(value)
        [ key, normalized ] if normalized.present?
      end.to_h
    end

    validate :publication_settings_are_offered
  end

  # Saves as much of a submitted set of settings as this level can accept, and answers with
  # what it had to refuse, as [option, value] pairs.
  #
  # An author edits every setting of a level in one modal and saves them together, so an
  # all-or-nothing write means one mistyped margin costs them the nine changes they made
  # beside it -- and costs them silently, since the modal is gone by the time they read why.
  # Each value stands or falls on its own instead: the rest is saved, and a refused key
  # keeps whatever this level had before rather than being cleared by a typo.
  #
  # Settings this level already held are checked too, and dropped if they no longer pass.
  # That only happens when the catalog stops permitting something already stored, and
  # dropping it is what keeps such a level saveable at all; it is not reported, because the
  # author did not submit it.
  def merge_publication_settings(submitted)
    submitted = submitted.to_h.stringify_keys
    previous = publication_settings
    self.publication_settings = previous.merge(submitted)

    accepted = publication_settings.select { |key, value| Publication::Catalog.find(key).permits?(value) }
    refused = publication_settings.except(*accepted.keys)
    restored = previous.slice(*refused.keys)
                       .select { |key, value| Publication::Catalog.find(key).permits?(value) }

    self.publication_settings = accepted.merge(restored)

    [ save, refused.slice(*submitted.keys).map { |key, value| [ Publication::Catalog.find(key), value ] } ]
  end

  private

    # Values are written into a publication file that a build server then runs, so they
    # are checked against the catalog rather than merely escaped on the way out. The
    # normalizer has already dropped unknown keys, so anything left has an option to
    # check against, and Publication::Catalog::Option#permits? owns what each kind of
    # option will accept -- a list, a number in a range, or a bare filename.
    def publication_settings_are_offered
      publication_settings.each do |key, value|
        option = Publication::Catalog.find(key)
        next if option.permits?(value)

        errors.add(:publication_settings, "has no #{option.label.downcase} of “#{value}”")
      end
    end
end
