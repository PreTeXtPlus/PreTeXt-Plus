require "uri"
require "net/http"
require "json"

# Queries the full build server directly for a build's current status. Used by
# BuildsController#check_status as a manual, on-demand alternative to waiting
# on the best-effort webhook callback (BuildCallbacksController) -- useful when
# a build seems stuck and you want to know whether it's still running or
# something failed silently server-side.
class BuildStatusChecker
  def initialize(build)
    @build = build
  end

  def check!
    return if @build.success? || @build.failed?
    return unless @build.remote_status_url.present?

    uri = URI.parse("https://#{ENV['FULL_BUILD_HOST']}#{@build.remote_status_url}")
    request = Net::HTTP::Get.new(uri)
    request["Authorization"] = "Bearer #{ENV['BUILD_TOKEN']}"

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.request(request)
    end
    return unless response.is_a?(Net::HTTPSuccess)

    data = JSON.parse(response.body)
    case data["status"]
    when "success"
      artifact_url = URI.join(uri, data["artifact_url"]).to_s
      FullBuildArtifactJob.perform_later(@build, artifact_url)
    when "failed"
      @build.update_columns(status: Build.statuses[:failed], log: data["log"])
    end
  end
end
