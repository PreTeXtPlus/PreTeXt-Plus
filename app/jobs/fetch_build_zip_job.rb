require "zip"

class FetchBuildZipJob < ApplicationJob
  queue_as :default

  def perform(build)
    build.update_column(:status, Build.statuses[:in_progress])
    require "uri"
    require "net/http"

    params = {
      source: build.project.pretext_source,
      token: ENV["BUILD_TOKEN"],
      format: "zip"
    }
    response = Net::HTTP.post_form(URI.parse("https://#{ENV['BUILD_HOST']}"), params)

    zip_buffer = StringIO.new(response.body)

    Zip::File.open_buffer(zip_buffer) do |zip|
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

      build.project.project_assets.each do |project_asset|
        library_asset = project_asset.library_asset
        next unless library_asset.file.attached?

        relative_path = "external/#{library_asset.id}"
        zip.get_output_stream(relative_path) { |os| os.write(library_asset.file.download) }

        build_file = build.build_files.create!(relative_path: relative_path)
        build_file.blob.attach(library_asset.file.blob)
      end
    end

    zip_buffer.rewind
    build.zip.attach(
      io: zip_buffer,
      filename: "build-#{build.id}.zip",
      content_type: "application/zip"
    )

    build.update_column(:status, Build.statuses[:success])
  rescue => e
    build.update_column(:status, Build.statuses[:failed])
    raise e
  end
end
