# Recurring safety net for builds whose full_callback silently never arrived
# (e.g. a build server that follows a scheme/host redirect but never actually
# hits our controller). Polls the build server directly for any build that's
# been in_progress too long, via BuildStatusChecker -- which already logs a
# warning when it discovers the server finished but we were never told.
class BuildWatchdogJob < ApplicationJob
  queue_as :default

  STUCK_AFTER = 5.minutes

  def perform
    Build.sent_to_server.where.not(remote_status_url: nil)
         .where(updated_at: ...STUCK_AFTER.ago).find_each do |build|
      BuildStatusChecker.new(build).check!
    end
  end
end
