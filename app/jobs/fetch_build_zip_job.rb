class FetchBuildZipJob < ApplicationJob
  queue_as :default

  def perform(build)
    require "uri"
    require "net/http"

    params = {
      source: build.project.pretext_source,
      token: ENV["BUILD_TOKEN"],
      format: "zip"
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)

    build.zip.attach(
      io: StringIO.new(response.body),
      filename: "build-#{build.id}.zip",
      content_type: "application/zip"
    )
    build.update_column(:status, Build.statuses[:success])
  rescue => e
    build.update_column(:status, Build.statuses[:failed])
    raise e
  end
end
