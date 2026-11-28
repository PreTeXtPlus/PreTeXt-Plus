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

  validates :name, presence: true, length: { maximum: 255 }

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
end
