require "net/http"

# Asks the build server to stop a build, and records the outcome locally.
#
# POST /builds/<job>/cancel drops a queued job and kills a running container. Two cases
# never reach it: a build we never managed to submit (no status URL yet), and a job the
# server no longer has -- expired past JOB_TTL, or finished in the moment between the
# author clicking and this request landing. Both still mark the build canceled here,
# because the point of the button is that the row stops saying Building and the
# concurrency cap frees up; the guards in BuildCallbacksController and
# FullBuildArtifactJob are what stop a build that finished in that gap from importing its
# output afterwards.
#
# A build server that errors or cannot be reached is the one case left alone: something
# may still be running there, so saying "canceled" would be a lie, and leaving the build
# in flight keeps it under BuildWatchdogJob where it belongs.
class BuildCanceller
  Result = Struct.new(:ok, :message, keyword_init: true) do
    alias_method :ok?, :ok
  end

  # What the log says afterwards. A canceled build has no build log of its own -- it was
  # stopped before the server had one to send -- and an empty pane invites the reader to
  # wonder what went wrong.
  CANCEL_LOG = "Build canceled.".freeze

  def initialize(build)
    @build = build
  end

  def cancel!
    unless @build.unresolved?
      return Result.new(ok: false, message: "That build has already finished.")
    end

    # Still sitting in our own queue, or it died before the server gave us a job id.
    # There is nothing on the build server to stop.
    if @build.remote_status_url.blank?
      @build.mark!(:canceled, log: CANCEL_LOG)
      return Result.new(ok: true, message: "Build canceled.")
    end

    response = FullBuildServer.post("#{@build.remote_status_url}/cancel")

    case response
    when Net::HTTPSuccess
      @build.mark!(:canceled, log: CANCEL_LOG)
      Result.new(ok: true, message: "Build canceled.")
    when Net::HTTPNotFound, Net::HTTPConflict
      # Nothing left there to cancel: the job finished, or aged out of the server's
      # store. Either way this build is not coming back, so it stops waiting.
      @build.mark!(:canceled, log: CANCEL_LOG)
      Result.new(ok: true, message: "That build had already finished on the build server. Marked it canceled here.")
    else
      Result.new(ok: false, message: "Build server wouldn't cancel it (HTTP #{response.code}). It may still be running.")
    end
  rescue => e
    Result.new(ok: false, message: "Couldn't reach the build server to cancel: #{e.class}: #{e.message}")
  end
end
