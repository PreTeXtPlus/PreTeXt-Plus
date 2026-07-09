require "uri"
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

  def initialize(build)
    @build = build
  end

  def check!
    if @build.success? || @build.failed?
      return Result.new(ok: true, message: "Build already #{@build.status}.")
    end

    unless @build.remote_status_url.present?
      return Result.new(ok: false, message: "No status URL on record for this build yet -- it may not have finished submitting.")
    end

    uri = URI.parse("https://#{ENV['FULL_BUILD_HOST']}#{@build.remote_status_url}")
    request = Net::HTTP::Get.new(uri)
    request["Authorization"] = "Bearer #{ENV['BUILD_TOKEN']}"

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.request(request)
    end

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
      artifact_url = URI.join(uri, data["artifact_url"]).to_s
      FullBuildArtifactJob.perform_later(@build, artifact_url)
      Result.new(ok: true, message: "Build server reports success -- importing files now.")
    when "failed"
      Rails.logger.warn("Build #{@build.id} was in_progress locally but build server already reports failure -- full_callback was likely never received.")
      @build.update_columns(status: Build.statuses[:failed], log: data["log"])
      Result.new(ok: false, message: "Build server reports failure: #{data["log"].to_s.truncate(300)}")
    else
      Result.new(ok: true, message: "Build server reports status: #{data["status"]}.")
    end
  rescue => e
    Result.new(ok: false, message: "Couldn't reach the build server: #{e.class}: #{e.message}")
  end
end
