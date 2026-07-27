class Build < ApplicationRecord
  belongs_to :target
  # Denormalized: a build's project is always its target's project. Kept so the existing
  # nested /projects/:project_id/builds/... routes -- including full_callback, whose URL
  # is baked into in-flight submissions and therefore cannot move -- keep working.
  belongs_to :project

  has_one_attached :zip
  has_many :build_files, dependent: :destroy

  # `canceled` is terminal but distinct from `failed`: nothing went wrong with the
  # source, the author simply stopped waiting, and a row that says Failed would send them
  # hunting through a log for an error that isn't there.
  enum :status, { pending: 0, in_progress: 1, success: 2, failed: 3, sent_to_server: 4,
                  received_from_server: 5, canceled: 6 },
       default: :pending, validate: true

  default_scope { order(created_at: :desc) }

  before_validation :inherit_project_from_target
  after_create :sync_target
  after_destroy :sync_target

  # Whether the build server still owes us an answer, and so whether there is anything
  # left to cancel. The list itself lives on Target, which is where it is read from most.
  def in_flight?
    Target::IN_FLIGHT.include?(status)
  end

  # The only way a build's status should ever change.
  #
  # Every transition used to be a bare update_column, which skips callbacks -- fine while
  # nothing needed to react, but it means an after_update_commit hook silently never
  # fires. Funnelling them here gives promotion (and, from PR 2, broadcasting the row)
  # exactly one home, so adding a new transition cannot quietly skip either.
  #
  # Still update_columns underneath: these are called from jobs where bumping the
  # record's own updated_at is the only side effect we want.
  def mark!(status, **attrs)
    update_columns(attrs.merge(status: Build.statuses.fetch(status.to_s),
                               updated_at: Time.current))
    target.sync_from_builds!
    target.broadcast_row
    self
  end

  private

    def inherit_project_from_target
      self.project ||= target&.project
    end

    def sync_target
      # When the whole target is going away, its pointers go with it.
      return if destroyed_by_association

      target&.sync_from_builds!
    end
end
