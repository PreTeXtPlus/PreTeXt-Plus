require "zip"
require "stringio"

# Packs a Project into an in-memory PreTeXt-CLI project archive (a zip) for the
# build server (pretext-plus-build-full), which runs a real `pretext build`
# inside a container. The same archive is what `projects#download` hands to an author,
# so whatever works on the server works on their machine.
#
# Layout produced:
#   project.ptx                  -- manifest declaring every one of the project's
#                                   targets, so one archive serves any build request
#   publication/publication.ptx  -- declares the `external` asset directory
#   source/main.ptx              -- project.pretext_source, already a complete,
#                                   standalone <pretext> document (docinfo + body,
#                                   with every <plus:* ref/> placeholder resolved)
#   source/external/<ref>.<ext>  -- each project asset, matching the bare
#                                   `<image source="<ref>.<ext>">` the editor emits
#
# NOTE: the external-directory placement (source/external) follows PreTeXt's
# default publication resolution (external dir relative to the main source file).
# If the full server resolves images elsewhere, this is the one path to adjust.
class ProjectArchiveBuilder
  PUBLICATION_PTX = <<~XML.freeze
    <?xml version="1.0" encoding="UTF-8"?>
    <publication>
      <source>
        <directories external="external" generated="generated"/>
      </source>
      <html>
        <resources host="cdn"/>
      </html>
    </publication>
  XML

  def initialize(project)
    @project = project
  end

  # The manifest, listing every target the project has. One archive therefore serves any
  # build request -- the server is told which target to build -- and the same zip is what
  # a downloaded project contains, so `pretext build <slug>` works locally for all of them.
  #
  # output-dir is set explicitly rather than relying on the CLI's default, because
  # FullBuildArtifactJob strips exactly that prefix off the returned zip entries.
  # output-filename is set wherever the schema allows it, which makes the entry point of
  # a single-file output known before the build runs. See schema/project-ptx.rnc in
  # PreTeXtBook/pretext-cli for which attributes each format accepts.
  def project_ptx
    targets = @project.targets.map { |target| target_element(target) }.join("\n    ")

    <<~XML
      <?xml version="1.0" encoding="UTF-8"?>
      <project ptx-version="2">
        <targets>
          #{targets}
        </targets>
      </project>
    XML
  end

  # Returns a rewound StringIO holding the zip bytes.
  def build
    buffer = Zip::OutputStream.write_buffer do |zip|
      zip.put_next_entry("project.ptx")
      zip.write(project_ptx)

      zip.put_next_entry("publication/publication.ptx")
      zip.write(PUBLICATION_PTX)

      zip.put_next_entry("source/main.ptx")
      zip.write(@project.pretext_source.to_s)

      @project.assets.each do |asset|
        next unless asset.file.attached?

        ext = asset.file.filename.extension_with_delimiter
        zip.put_next_entry("source/external/#{asset.ref}#{ext}")
        zip.write(asset.file.download)
      end

      unless @project.assets.find_by(ref: "icon").present?
        zip.put_next_entry("source/external/icon.png")
        zip.write(File.read Rails.root.join("public", "icon-small.png"))
      end
    end
    buffer.rewind
    buffer
  end

  private

    # `manifest_attributes` is whatever the target's kind decided it emits (a SCORM
    # package contributes both format and compression), plus any per-target options. The
    # two attributes named here are ours rather than the kind's: output-dir because
    # FullBuildArtifactJob strips exactly this prefix, and output-filename because fixing
    # it to the slug is what makes a single-file artifact's path knowable up front.
    #
    # @name is the target's slug, not its display name: this is what `pretext build <x>`
    # takes on a downloaded copy, and the schema will not accept "Instructor edition".
    def target_element(target)
      attributes = {
        "name" => target.slug
      }.merge(target.manifest_attributes).merge(
        "output-dir" => target.slug,
        "output-filename" => target.output_filename
      ).compact

      pairs = attributes.map { |key, value| %(#{key}="#{ERB::Util.html_escape(value)}") }
      "<target #{pairs.join(' ')} />"
    end
end
