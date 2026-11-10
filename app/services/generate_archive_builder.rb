require "zip"

# Packs a one-figure PreTeXt project for the build server's `/generate`: the same
# layout ProjectArchiveBuilder gives a full build -- manifest, publication files,
# source/main.ptx -- holding only the one generated asset to render, so that the
# single file the job produces is the figure asked for, and the project's docinfo
# exactly as a build carries it, so that the file lands in the project's asset cache
# under the key the next full build will look for (see SourceAssembler.single_image).
#
# No external files: a generated asset has none, and the picture is the output.
class GenerateArchiveBuilder
  # The one target. Its format is what decides which picture format the CLI makes
  # (`ASSET_FORMATS["html"]` in pretext-cli): SVG for a sageplot, an HTML page for an
  # asymptote. The name is also what the request to `/generate` passes as `target`.
  TARGET = "web".freeze

  def initialize(project, asset)
    @project = project
    @asset = asset
  end

  def project_ptx
    Nokogiri::XML::Builder.new(encoding: "UTF-8") { |xml|
      xml.project("ptx-version" => "2") {
        xml.targets {
          xml.target("name" => TARGET, "format" => "html", "output-dir" => TARGET,
                     "publication" => "#{TARGET}.ptx")
        }
      }
    }.to_xml(indent: 2)
  end

  # Returns a rewound StringIO holding the zip bytes.
  # @raise [SourceAssembler::AssemblyError]
  def build
    source = SourceAssembler.single_image(@project, @asset).call
    publication = ProjectArchiveBuilder.new(@project).publication_ptx(@project)

    buffer = Zip::OutputStream.write_buffer do |zip|
      zip.put_next_entry("project.ptx")
      zip.write(project_ptx)
      zip.put_next_entry("#{ProjectArchiveBuilder::PUBLICATION_DIR}/publication.ptx")
      zip.write(publication)
      zip.put_next_entry("#{ProjectArchiveBuilder::PUBLICATION_DIR}/#{TARGET}.ptx")
      zip.write(publication)
      zip.put_next_entry("source/main.ptx")
      zip.write(source)
    end
    buffer.rewind
    buffer
  end
end
