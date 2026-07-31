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
    # all, so neither is worth storing. Doing it here rather than in the controller keeps
    # the column clean whatever writes to it -- including Project#full_dup, which copies
    # attributes wholesale, and the console.
    normalizes :publication_settings, with: ->(settings) do
      (settings || {}).to_h.stringify_keys
        .select { |key, value| Publication::Catalog.find(key) && value.present? }
        .transform_values(&:to_s)
    end

    validate :publication_settings_are_offered
  end

  private

    # Values are written into a publication file that a build server then runs, so they
    # are checked against the catalog rather than merely escaped on the way out. The
    # normalizer has already dropped unknown keys, so anything left has an option to
    # check against.
    #
    # Checked against every value the option allows for *any* document type, not just this
    # one: a book that becomes an article keeps its level-4 numbering setting, PreTeXt
    # clamps it, and re-saving something unrelated should not fail on it.
    def publication_settings_are_offered
      publication_settings.each do |key, value|
        option = Publication::Catalog.find(key)
        next if option.values.include?(value)

        errors.add(:publication_settings, "has no #{option.label.downcase} called “#{value}”")
      end
    end
end
