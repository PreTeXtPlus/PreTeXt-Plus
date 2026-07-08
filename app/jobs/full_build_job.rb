require "uri"
require "net/http"

# Submits a build to the build server (pretext-plus-build-full).
#
# The server is asynchronous: POST /builds accepts the project archive and then
# calls our webhook (BuildCallbacksController) when the build finishes, handing
# back the artifact_url to download. We only *submit* here; the download happens
# in FullBuildArtifactJob, triggered by the callback -- so nothing about the
# remote job needs to be persisted between the two steps.
class FullBuildJob < ApplicationJob
  queue_as :default

  def perform(build)
    build.update_column(:status, Build.statuses[:in_progress])

    archive = ProjectArchiveBuilder.new(build.project).build

    uri = URI.parse("https://#{ENV['FULL_BUILD_HOST']}/builds")
    request = Net::HTTP::Post.new(uri)
    request["Authorization"] = "Bearer #{ENV['FULL_BUILD_TOKEN']}"
    request.set_form(
      [
        [ "archive", archive, { filename: "project.zip", content_type: "application/zip" } ],
        [ "target", ProjectArchiveBuilder::TARGET ],
        [ "callback_url", callback_url(build) ]
      ],
      "multipart/form-data"
    )

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.request(request)
    end

    unless response.is_a?(Net::HTTPSuccess)
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
    # accordingly. Falls back to the app's configured mailer host.
    def callback_url(build)
      host = ENV["FULL_BUILD_CALLBACK_HOST"].presence ||
             Rails.application.config.action_mailer.default_url_options[:host]
      Rails.application.routes.url_helpers.full_callback_project_build_url(
        build.project, build, host: host
      )
    end
end
