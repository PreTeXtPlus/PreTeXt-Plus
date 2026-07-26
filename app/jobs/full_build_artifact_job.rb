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
    request["Authorization"] = "Bearer #{Rails.application.credentials.dig(:full_build, :token)}"

    response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.request(request)
    end

    unless response.is_a?(Net::HTTPSuccess)
      build.mark!(:failed)
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
        # Zip entries come out as "<target>/..." (e.g. "web/index.html") since the build
        # server zips its output/ dir, and ProjectArchiveBuilder sets each target's
        # output-dir to its own name. Strip that prefix so stored paths are just
        # "index.html", matching what BuildFilesController and build_file_path expect.
        relative_path = entry.name.delete_prefix("#{build.target.name}/")
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

    build.mark!(:success, entry_path: detect_entry_path(build))
  rescue => e
    build.mark!(:failed)
    raise e
  end

  private

    # What a reader should be sent to. An html site has an index; a pdf or braille build
    # is one file whose name PreTeXt chose. Recorded now, from the files that actually
    # arrived, rather than guessed later from the format.
    def detect_entry_path(build)
      paths = build.build_files.pluck(:relative_path)
      return nil if paths.empty?

      # What the manifest asked for, when the schema let us ask (ProjectArchiveBuilder).
      requested = build.target.output_filename
      return requested if requested && paths.include?(requested)

      return "index.html" if build.target.site? && paths.include?("index.html")

      # Otherwise the shallowest file with an extension the format is known to produce --
      # shallowest so a stray asset in a subdirectory never beats the real artifact.
      extensions = Target::OUTPUT_EXTENSIONS.fetch(build.target.output_format, [])
      candidates = paths.select { |p| extensions.include?(File.extname(p).downcase) }
      candidates.min_by { |p| [ p.count("/"), p.length ] } || paths.min_by(&:length)
    end
end
