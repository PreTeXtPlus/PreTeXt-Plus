require "net/http"
require "json"

# Queries the full build server directly for a build's current status. Used by
# BuildsController#check_status as a manual, on-demand alternative to waiting
# on the best-effort webhook callback (BuildCallbacksController) -- useful when
# a build seems stuck and you want to know whether it's still running or
# something failed silently server-side.
#
# check! always returns a Result so the controller has something concrete to
# show the user, instead of a silent redirect that looks like nothing happened.
class BuildStatusChecker
  Result = Struct.new(:ok, :message, keyword_init: true) do
    alias_method :ok?, :ok
  end

  # Both ok: true, because the output is there. What differs is whose move it is.
  AWAITING_REVIEW = "The build reported errors. Its output is imported and ready to " \
                    "preview, but readers do not see it until you choose to use it.".freeze
  BUILT_WITH_ERRORS = "The build reported errors. You chose to use its output, so it is " \
                      "what readers see.".freeze

  def initialize(build)
    @build = build
  end

  def check!
    if @build.successful?
      return Result.new(ok: true, message: AWAITING_REVIEW) if @build.success_awaiting_review?
      return Result.new(ok: true, message: BUILT_WITH_ERRORS) if @build.built_with_errors?

      return Result.new(ok: true, message: "Build was successful!")
    end

    if @build.failed?
      return Result.new(ok: false, message: "The build failed.")
    end

    if @build.canceled?
      return Result.new(ok: false, message: "This build was canceled.")
    end

    unless @build.remote_status_url.present?
      return Result.new(ok: false, message: "No status URL on record for this build yet -- it may not have finished submitting.")
    end

    response = FullBuildServer.get(@build.remote_status_url)

    unless response.is_a?(Net::HTTPSuccess)
      return Result.new(ok: false, message: "Build server returned HTTP #{response.code}: #{response.body.to_s.truncate(300)}")
    end

    data = JSON.parse(response.body)
    case data["status"]
    when "success"
      # Reaching here means the build was still `in_progress` locally (see the
      # early-return above) even though the server considers it done -- the
      # webhook callback never arrived (e.g. swallowed by a redirect). Warn so
      # a silently dropped callback shows up in logs instead of only being
      # noticed when someone happens to click "check status".
      Rails.logger.warn("Build #{@build.id} was in_progress locally but build server already reports success -- full_callback was likely never received.")
      @build.mark!(:received_from_server, log: remote_log(data))
      FullBuildArtifactJob.perform_later(@build, FullBuildServer.url_for(data["artifact_url"]))
      Result.new(ok: true, message: "Build server reports success -- importing files now.")
    when "failed"
      Rails.logger.warn("Build #{@build.id} was in_progress locally but build server already reports failure -- full_callback was likely never received.")
      # Same rule as the webhook: the server offers `artifact_url` whenever the build
      # left an output.zip behind, failure or not, so that -- not the status word -- is
      # what says whether there is output to import. See BuildCallbacksController.
      if data["artifact_url"].present?
        @build.mark!(:received_from_server_flagged, log: remote_log(data))
        FullBuildArtifactJob.perform_later(@build, FullBuildServer.url_for(data["artifact_url"]))
        return Result.new(ok: true, message: "The build reported errors but still produced output -- " \
                                             "importing it now. It won't go live until you choose to use it.")
      end

      @build.mark!(:failed, log: remote_log(data))
      Result.new(ok: false, message: "Build server reports failure: #{remote_log(data).truncate(300)}")
    else
      Result.new(ok: true, message: "Build server reports status: #{data["status"]}.")
    end
  rescue => e
    Result.new(ok: false, message: "Couldn't reach the build server: #{e.class}: #{e.message}")
  end

  private

    # GET /builds/<job> returns the server's whole job record, so unlike the webhook
    # payload -- which carries only a truncated tail and a URL for the rest -- `log` here
    # is already the complete log. No follow-up fetch, and no FullBuildLogJob.
    def remote_log(data)
      data["log"].presence || BuildCallbacksController::NO_LOG
    end
end
