require "zip"
require "uri"
require "net/http"

# Downloads and unpacks a finished build's artifact (output.zip) from the build
# server. Triggered by BuildCallbacksController once the server reports success;
# artifact_url is the download URL the callback handed us. Each zip entry becomes
# a BuildFile, and the whole zip is attached for download.
class FullBuildArtifactJob < ApplicationJob
  queue_as :default

  def perform(build, artifact_url)
    return if build.success?

    uri = URI.parse(artifact_url)
    request = Net::HTTP::Get.new(uri)
    request["Authorization"] = "Bearer #{ENV['FULL_BUILD_TOKEN']}"

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.request(request)
    end

    unless response.is_a?(Net::HTTPSuccess)
      build.update_column(:status, Build.statuses[:failed])
      Rails.logger.error("Artifact fetch failed for build #{build.id} (HTTP #{response.code})")
      return
    end

    zip_buffer = StringIO.new(response.body)
    Zip::File.open_buffer(zip_buffer) do |zip|
      zip.each do |entry|
        next unless entry.file?
        # Skip macOS AppleDouble resource-fork junk (e.g. "._foo.ttf",
        # "__MACOSX/...") that ends up in the artifact zip -- not real build
        # output, and importing it roughly doubles the file count.
        next if entry.name.start_with?("__MACOSX/") || File.basename(entry.name).start_with?("._")
        content = entry.get_input_stream.read
        # Zip entries come out as "<target>/..." (e.g. "web/index.html") since
        # the build server zips its output/ dir, and PreTeXt writes each
        # target's output to output/<target>/. Strip that prefix so stored
        # paths are just "index.html", matching what BuildFilesController and
        # build_file_path expect.
        relative_path = entry.name.delete_prefix("#{ProjectArchiveBuilder::TARGET}/")
        build_file = build.build_files.create!(relative_path: relative_path)
        build_file.blob.attach(
          io: StringIO.new(content),
          filename: File.basename(entry.name),
          content_type: Marcel::MimeType.for(name: entry.name)
        )
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
