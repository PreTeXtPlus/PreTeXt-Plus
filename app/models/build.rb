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

  # pretext-cli logs through click, which colours its level labels, so what arrives in a
  # log is "\e[33mwarning: \e[0m..." rather than "warning: ". Nothing downstream renders
  # terminal colour -- the drawer is a <pre> -- so the codes would show up as literal
  # "[33m" noise in front of exactly the lines an author most needs to read. Matches the
  # CSI sequences click emits (colour, bold, reset) plus OSC strings, which nothing sends
  # today but which would otherwise leave a stray "]0;" behind if the CLI ever did.
  ANSI_ESCAPE = /\e\[[0-9;:?]*[ -\/]*[@-~]|\e\][^\a\e]*(?:\a|\e\\)?/

  before_validation :inherit_project_from_target
  after_create :sync_target
  after_destroy :sync_target

  # Whether the build server still owes us an answer, and so whether there is anything
  # left to cancel. The list itself lives on Target, which is where it is read from most.
  def in_flight?
    Target::IN_FLIGHT.include?(status)
  end

  # Whether PublishBuildFilesJob has actually finished making this build's stored files
  # world-readable, and so whether a plain cdn.pretext.plus URL for them will resolve.
  # Only ever true for a published single-file target's build -- see
  # Target#make_current_build_public!, which is the only thing that enqueues that job.
  def files_public?
    files_public_at.present?
  end

  # The only way a build's status should ever change.
  #
  # Every transition used to be a bare update_column, which skips callbacks -- fine while
  # nothing needed to react, but it means an after_update_commit hook silently never
  # fires. Funnelling them here gives promotion (and, from PR 2, broadcasting the row and
  # the open drawer) exactly one home, so adding a new transition cannot quietly skip any
  # of them.
  #
  # Still update_columns underneath: these are called from jobs where bumping the
  # record's own updated_at is the only side effect we want.
  # Stripping here rather than in the view or at each write site: mark! is the one funnel
  # every log passes through (callback tail, full log fetched out of band, cancel notice),
  # so the column holds plain text and anything that reads it later -- drawer, mailer,
  # console -- gets it clean without repeating the scrub.
  def mark!(status, **attrs)
    attrs[:log] = attrs[:log].gsub(ANSI_ESCAPE, "") if attrs[:log].is_a?(String)

    update_columns(attrs.merge(status: Build.statuses.fetch(status.to_s),
                               updated_at: Time.current))
    target.sync_from_builds!
    target.broadcast_row
    target.broadcast_drawer
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
