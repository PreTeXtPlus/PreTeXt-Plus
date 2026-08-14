require "zip"
require "uri"
require "net/http"

# Downloads and unpacks a finished build's artifact (output.zip) from the build
# server. Triggered by BuildCallbacksController once the server offers an artifact_url,
# which it does whenever a build left output behind -- including a build it reports as
# failed (see received_from_server_flagged on Build). Each zip entry becomes a BuildFile,
# and the whole zip is attached for download.
#
# The import itself doesn't branch on whether the build was flagged -- output is output --
# but #perform reads that off `build.status` (received_from_server_flagged?) before the
# completing mark! overwrites it, and uses it to choose success vs. success_awaiting_review.
# A build whose import fails after that read simply ends up :failed, same as any other --
# see Build#built_with_errors? for why that's the right outcome.
#
# This is the job that ends a build, and the dashboard reflects that: `success` from the
# build server only moves a build to `received_from_server`, which Target::IN_FLIGHT still
# counts as Building. So a build whose import never finishes reads as a build that never
# finished -- see BuildRecheckJob, which is what notices.
class FullBuildArtifactJob < ApplicationJob
  queue_as :default

  # A whole site's zip, not a status blob, so it gets its own ceiling rather than
  # FullBuildServer's default. Long enough for a large book over a slow link; finite
  # because the alternative is what this constant was added to fix -- a build server that
  # accepts the connection and then goes quiet used to hang this job (and the row that
  # says Building) for as long as the process lived.
  ARTIFACT_READ_TIMEOUT = 120

  # Appended rather than written over the log: what the callback left there is the CLI's
  # own output, which is the part an author can act on. This says why a build whose log
  # ends in "Success!" is nonetheless showing as failed.
  TIMEOUT_LOG = "Couldn't download the finished output from the build server (timed out). " \
                "The build itself completed -- please try building again.".freeze

  def perform(build, artifact_url)
    # Cancelled as well as already-imported: a cancel can land while the artifact is
    # downloading, and finishing the import would republish output nobody is waiting for.
    return if build.successful? || build.canceled?

    # Read before the completing mark! below overwrites it -- update_columns mutates the
    # in-memory attribute too, so this has to be captured now or the flag is lost.
    flagged = build.received_from_server_flagged?

    response = FullBuildServer.get(artifact_url, read_timeout: ARTIFACT_READ_TIMEOUT)

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
        relative_path = entry.name.delete_prefix("#{build.target.slug}/")
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

    build.mark!(flagged ? :success_awaiting_review : :success, entry_path: detect_entry_path(build))

    # A new success is the one moment history grows, so it is also when the retention
    # window (Target::KEPT_SUCCESSES) is enforced -- no scheduled sweep to forget about.
    build.target.prune_builds!
  rescue Net::OpenTimeout, Net::ReadTimeout => e
    # Not re-raised, unlike everything below: a retry against a build server that has
    # already stopped answering buys nothing, and the point of catching this at all is
    # that the row stops saying Building.
    build.mark!(:failed, log: [ build.log, TIMEOUT_LOG ].compact_blank.join("\n\n"))
    Rails.logger.warn("Artifact fetch for build #{build.id} timed out (#{e.class}).")
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

      # Otherwise the shallowest file with an extension the kind is known to produce --
      # shallowest so a stray asset in a subdirectory never beats the real artifact. The
      # kind is what is consulted, not the format: a SCORM package and a website are both
      # format="html" but leave behind a .zip and a tree of .html respectively.
      extensions = build.target.output_extensions
      candidates = paths.select { |p| extensions.include?(File.extname(p).downcase) }
      candidates.min_by { |p| [ p.count("/"), p.length ] } || paths.min_by(&:length)
    end
end
