require "uri"
require "net/http"

# Submits a build to the build server (pretext-plus-build-full).
#
# The server is asynchronous: POST /builds accepts the project archive and then
# calls our webhook (BuildCallbacksController) when the build finishes, handing
# back the artifact_url to download. We only *submit* here; the download happens
# in FullBuildArtifactJob, triggered by the callback. We also save the server's
# status_url so BuildsController#check_status can poll it on demand -- the
# callback is best-effort, so this is the fallback for finding out what's
# actually happening with a build that seems stuck.
class FullBuildJob < ApplicationJob
  queue_as :default

  def perform(build)
    build.update_column(:status, Build.statuses[:in_progress])

    archive = ProjectArchiveBuilder.new(build.project).build

    uri = URI.parse("https://#{Rails.application.credentials.dig(:full_build, :host)}/builds")
    request = Net::HTTP::Post.new(uri)
    request["Authorization"] = "Bearer #{Rails.application.credentials.dig(:full_build, :token)}"
    resolved_callback_url = callback_url(build)
    Rails.logger.info("FullBuildJob submitting build #{build.id} with callback_url=#{resolved_callback_url}")
    request.set_form(
      [
        [ "archive", archive, { filename: "project.zip", content_type: "application/zip" } ],
        [ "target", ProjectArchiveBuilder::TARGET ],
        [ "callback_url", resolved_callback_url ]
      ],
      "multipart/form-data"
    )

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.request(request)
    end

    if response.is_a?(Net::HTTPSuccess)
      status_url = JSON.parse(response.body)["status_url"]
      build.update_column(:status, Build.statuses[:sent_to_server])
      build.update_column(:remote_status_url, status_url) if status_url.present?
    else
      build.update_column(:status, Build.statuses[:failed])
      Rails.logger.error("FullBuildJob submit failed for build #{build.id} (HTTP #{response.code}): #{response.body}")
    end
  rescue => e
    build.update_column(:status, Build.statuses[:failed])
    raise e
  end

  private

    # Public URL the full server POSTs status back to. Must be reachable from the
    # build server, so in local dev this needs a tunnel; set FULL_BUILD_CALLBACK_HOST
    # accordingly (bin/dev sets this automatically in a GitHub Codespace). Otherwise
    # falls back to the app's configured mailer host.
    def callback_url(build)
      host = ENV["FULL_BUILD_CALLBACK_HOST"].presence ||
             Rails.application.config.action_mailer.default_url_options[:host]
      # Codespaces-forwarded ports and production are HTTPS-only: a plain http
      # callback gets a 308 redirect that the build server won't follow, so the
      # webhook never fires. Emit https unless we're on bare localhost dev.
      protocol = host.to_s.start_with?("localhost") ? "http" : "https"
      Rails.application.routes.url_helpers.full_callback_project_build_url(
        build.project, build, host: host, protocol: protocol
      )
    end
end
