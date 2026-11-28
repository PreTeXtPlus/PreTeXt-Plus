# A named, ordered group of projects, owned by one user. A project can sit in any
# number of collections, but only its owner can put it in one (see
# CollectionMembership), and it leaves every collection when ownership changes.
class Collection < ApplicationRecord
  belongs_to :user

  has_many :collection_memberships, -> { order(:position) }, dependent: :destroy, inverse_of: :collection
  # In the owner's manual order, through the memberships' scope.
  has_many :projects, through: :collection_memberships

  # Same meaning as Project#visibility: private is owner-only, unlisted is readable
  # by anyone with the link, public may also be listed. A visible collection can
  # still contain private projects, so whatever renders it must filter its projects
  # by what the viewer may read.
  enum :visibility, { private: 0, unlisted: 1, public: 2 }, default: :private, suffix: true, validate: true

  scope :publicly_listed, -> { where(visibility: :public) }

  # Lowercase words joined by single hyphens, so it can sit in a URL beside the
  # owner's username. Unique among one user's collections only; the
  # [user_id, slug] index backs this against concurrent creates.
  SLUG_FORMAT = /\A[a-z0-9]+(?:-[a-z0-9]+)*\z/

  normalizes :slug, with: ->(slug) { slug.strip.downcase.presence }

  validates :name, presence: true, length: { maximum: 255 }
  validates :slug, presence: true, length: { maximum: 100 },
    format: { with: SLUG_FORMAT, message: "may only contain lowercase letters, numbers, and single hyphens" },
    uniqueness: { scope: :user_id }

  # Derived from the name when none is given; set or change it explicitly to choose one.
  before_validation :assign_slug, on: :create

  # Puts the listed projects first, in the given order; ids that are not in this
  # collection are ignored, and any member left out of the list keeps its relative
  # order after the listed ones.
  def reorder_projects!(project_ids)
    ids = Array(project_ids).map(&:to_s)
    memberships = collection_memberships.to_a
    listed = ids.filter_map { |id| memberships.find { |m| m.project_id == id } }.uniq
    ordered = listed + (memberships - listed)

    transaction do
      ordered.each_with_index do |membership, index|
        membership.update!(position: index) unless membership.position == index
      end
    end
    collection_memberships.reset
    projects.reset
    self
  end

  private

  # The name, parameterized and trimmed to fit, with -2, -3, ... appended until it is
  # free among the owner's collections. A name with nothing URL-safe in it ("★")
  # falls back to "collection".
  def assign_slug
    return if slug.present? || name.blank?

    base = name.parameterize.first(90).delete_suffix("-").presence || "collection"
    self.slug = base
    suffix = 2
    while user&.collections&.exists?(slug: slug)
      self.slug = "#{base}-#{suffix}"
      suffix += 1
    end
  end
end
