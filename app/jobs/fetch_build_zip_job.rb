require "zip"

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

    Zip::File.open_buffer(StringIO.new(response.body)) do |zip|
      zip.each do |entry|
        next unless entry.file?
        content = entry.get_input_stream.read
        build_file = build.build_files.create!(relative_path: entry.name)
        build_file.blob.attach(
          io: StringIO.new(content),
          filename: File.basename(entry.name),
          content_type: Marcel::MimeType.for(name: entry.name)
        )
      end
    end

    build.project.project_assets.each do |project_asset|
      library_asset = project_asset.library_asset
      next unless library_asset.file.attached?

      build_file = build.build_files.create!(relative_path: "external/#{library_asset.id}")
      build_file.blob.attach(library_asset.file.blob)
    end

    build.update_column(:status, Build.statuses[:success])
  rescue => e
    build.update_column(:status, Build.statuses[:failed])
    raise e
  end
end
