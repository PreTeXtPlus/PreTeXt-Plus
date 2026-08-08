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
  #
  # `queued` is not terminal and not in Target::IN_FLIGHT: it means this build was
  # created but deliberately not sent to FullBuildJob yet, because the author already
  # had MAX_CONCURRENT builds running. It waits here -- not counting against the cap
  # it's waiting on -- until promote_next_queued_build! (see #mark!) hands it a slot.
  enum :status, { pending: 0, in_progress: 1, success: 2, failed: 3, sent_to_server: 4,
                  received_from_server: 5, canceled: 6, queued: 7 },
       default: :pending, validate: true

  default_scope { order(created_at: :desc) }

  # How many builds one author may have actually running at once, across every project
  # they own or collaborate on. A container on the build server is a real, per-minute
  # cost that does not shrink just because the author was careful about requesting it --
  # this is the bound that protects that cost. Builds requested beyond it queue instead
  # of being refused; see #slot_available? and Build#mark!'s promote_next_queued_build!.
  MAX_CONCURRENT = 3

  def self.in_flight_count(user)
    where(project_id: user.project_ids, status: statuses.values_at(*Target::IN_FLIGHT)).count
  end

  def self.slot_available?(user)
    in_flight_count(user) < MAX_CONCURRENT
  end

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

  # Whether this build has not yet reached an outcome, and so whether there is anything
  # left to cancel -- either the build server still owes us an answer, or (queued) we
  # haven't sent it there yet. The list itself lives on Target, which is where it is
  # read from most.
  def unresolved?
    Target::UNRESOLVED.include?(status)
  end

  def in_flight?
    Target::IN_FLIGHT.include?(status)
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
    promote_next_queued_build! unless in_flight?
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

    # Fires every time a build stops occupying a slot -- finishing, or being canceled
    # before it ever started -- so the next queued build (oldest first, same author,
    # any of their projects) gets that slot immediately rather than waiting on some
    # other trigger to notice. Guarded by slot_available? because not every call here
    # actually freed anything: a queued build's own cancellation reaches this too, and
    # by then nothing may be free at all.
    def promote_next_queued_build!
      owner = target.project.user
      return unless Build.slot_available?(owner)

      next_up = Build.where(project_id: owner.project_ids, status: :queued).reorder(created_at: :asc).first
      return unless next_up

      next_up.mark!(:pending)
      FullBuildJob.perform_later(next_up)
    end
end
