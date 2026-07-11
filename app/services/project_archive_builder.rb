require "zip"
require "stringio"

# Packs a Project into an in-memory PreTeXt-CLI project archive (a zip) for the
# build server (pretext-plus-build-full), which runs a real `pretext build`
# inside a container.
#
# Layout produced:
#   project.ptx                  -- manifest with one `web` (html) target
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
  # The target name submitted alongside the archive; must match project.ptx.
  TARGET = "web".freeze

  PROJECT_PTX = <<~XML.freeze
    <?xml version="1.0" encoding="UTF-8"?>
    <project ptx-version="2">
      <targets>
        <target name="#{TARGET}" format="html" />
      </targets>
    </project>
  XML

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

  # Returns a rewound StringIO holding the zip bytes.
  def build
    buffer = Zip::OutputStream.write_buffer do |zip|
      zip.put_next_entry("project.ptx")
      zip.write(PROJECT_PTX)

      zip.put_next_entry("publication/publication.ptx")
      zip.write(PUBLICATION_PTX)

      zip.put_next_entry("source/main.ptx")
      zip.write(@project.pretext_source.to_s)

      @project.project_assets.each do |project_asset|
        library_asset = project_asset.library_asset
        next unless library_asset.file.attached?

        ext = library_asset.file.filename.extension_with_delimiter
        zip.put_next_entry("source/external/#{project_asset.ref}#{ext}")
        zip.write(library_asset.file.download)
      end
    end
    buffer.rewind
    buffer
  end
end
