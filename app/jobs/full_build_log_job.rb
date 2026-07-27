require "net/http"

# Replaces a build's inline log tail with the full log from the build server.
#
# The completion callback deliberately carries only the last CALLBACK_LOG_TAIL_CHARS of
# the log (4000 by default) -- enough for the PreTeXt error that usually sits at the end,
# but not for a Sage traceback or a long list of missing images. The server exposes the
# whole thing at /builds/<job>/log and expects the receiver to come back for it, which is
# what this does, out of band: the tail is already on the record by the time this runs,
# so a slow or unreachable log endpoint costs detail rather than the whole log.
class FullBuildLogJob < ApplicationJob
  queue_as :default

  def perform(build, log_url)
    response = FullBuildServer.get(log_url)

    unless response.is_a?(Net::HTTPSuccess)
      Rails.logger.warn("Full log fetch for build #{build.id} returned HTTP #{response.code} -- keeping the tail from the callback.")
      return
    end

    return if response.body.blank?

    # mark! with the status the build already has. The status is not this job's to decide
    # -- FullBuildArtifactJob may well have moved it to success while this was in flight,
    # and reload is what keeps this from writing back the stale one -- but going through
    # mark! rather than update_column keeps the target pointers and the dashboard
    # broadcast in step, as every other write to a build does.
    build.reload
    build.mark!(build.status, log: response.body)
  rescue Net::OpenTimeout, Net::ReadTimeout => e
    # The tail is already recorded and a build log is not worth a retry storm.
    Rails.logger.warn("Full log fetch for build #{build.id} timed out (#{e.class}) -- keeping the tail from the callback.")
  end
end
