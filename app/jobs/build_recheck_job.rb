# Checks back on a build a little after it was started, and keeps checking until it has
# actually landed. Scheduled by BuildsController#create, so every build has one.
#
# Everything about a build's progress reaches the dashboard by being pushed: the build
# server calls our webhook, the webhook (or the artifact import behind it) moves the
# build, and Build#mark! broadcasts the row. That chain is four hops long and every hop
# is a place where a build finishes and the page does not notice:
#
#   * the callback never arrives, or we reject it -- the build sits in `sent_to_server`;
#   * the callback arrives and the artifact import then dies or hangs -- the build sits
#     in `received_from_server`, which Target::IN_FLIGHT still reads as Building, so a
#     server that reported "success" leaves the row saying Building anyway;
#   * everything works and the broadcast goes out while a dashboard is not listening --
#     asleep, offline, or reconnecting -- and Action Cable does not replay what was
#     missed, so the row keeps whatever state it was rendered with.
#
# The last one is why this broadcasts again even when it finds nothing wrong: a build
# that finished correctly is precisely the case where a stale row is invisible to us and
# obvious to the author. A re-render of one row is cheap; being wrong about a build for
# as long as a page stays open is not.
class BuildRecheckJob < ApplicationJob
  queue_as :default

  # A build that no longer exists needs no chasing -- prune_builds! deletes attempts out
  # from under scheduled jobs by design.
  discard_on ActiveJob::DeserializationError

  # How long to leave a build alone before the first look, and between looks after that.
  # Most builds are done well inside one interval, so in the ordinary case this runs
  # once, finds a finished build, re-broadcasts it and stops.
  RECHECK_AFTER = 30.seconds

  # Roughly fifteen minutes of looking. Past that a build is the build server's problem
  # rather than a missed message, and in production BuildWatchdogJob still sweeps.
  MAX_ATTEMPTS = 30

  # How long an import may go without producing anything before it is treated as dead.
  # Measured against real progress (see #last_progress_at), not against the clock, so a
  # slow but living import of a large site is never cut off part way.
  STALL_AFTER = 5.minutes

  # Appended to the CLI's own log, which by this point says the build succeeded -- the
  # part that failed is ours, and saying so is better than a bare "Failed".
  STALLED_LOG = "The build finished, but importing its output into PreTeXt.Plus stopped " \
                "part way. Please try building again.".freeze

  def perform(build, attempt: 1)
    advance(build)
    build.reload

    if !build.in_flight?
      # Terminal, so whatever moved it broadcast at the time. This is the second copy,
      # for whoever was not listening then; a row re-rendered from the same record is
      # identical to the one they should already have.
      build.target.broadcast_row
      build.target.broadcast_drawer
    elsif attempt < MAX_ATTEMPTS
      self.class.set(wait: RECHECK_AFTER).perform_later(build, attempt: attempt + 1)
    end
  end

  private

    # What this particular kind of stuck needs. Anything still `pending` or `in_progress`
    # has not reached the build server yet -- it is our own queue that is behind, and
    # there is nothing to ask anyone about.
    def advance(build)
      case build.status
      when "sent_to_server"
        # The server owes us a callback. BuildStatusChecker asks it directly, marks the
        # build if it has an answer, and logs when it finds one we should have been told
        # about -- so a dropped webhook heals here rather than waiting on the watchdog.
        BuildStatusChecker.new(build).check! if build.remote_status_url.present?
      when "received_from_server"
        fail_stalled_import(build)
      end
    end

    # The callback landed and FullBuildArtifactJob owns the build from here. It cannot be
    # restarted from outside -- a second import would fight the first for BuildFile's
    # unique relative_path -- so the only thing to decide is whether it is still alive.
    #
    # Marking it failed is not the last word either: an import that was merely very slow
    # still calls mark!(:success) when it finishes, and the row corrects itself.
    def fail_stalled_import(build)
      return unless last_progress_at(build) < STALL_AFTER.ago
      # Re-read first: the import may well have landed while this job was being picked up,
      # and a build that just succeeded must not be marked failed behind it.
      return unless build.reload.received_from_server?

      build.mark!(:failed, log: [ build.log, STALLED_LOG ].compact_blank.join("\n\n"))
      Rails.logger.error("Build #{build.id} stalled in received_from_server -- no import " \
                         "progress since #{last_progress_at(build)}. Marked failed.")
    end

    # The most recent sign of life. A running import writes a BuildFile per zip entry as
    # it goes, so its files are a better clock than the build row, which mark! last
    # touched when the callback arrived.
    def last_progress_at(build)
      [ build.updated_at, build.build_files.maximum(:updated_at) ].compact.max
    end
end
