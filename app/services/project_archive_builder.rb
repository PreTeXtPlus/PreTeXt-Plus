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
#   publication/publication.ptx  -- the project's own publisher options; what a target
#                                   added by hand to a downloaded copy would pick up
#   publication/<slug>.ptx       -- one per target, holding that output's options
#                                   resolved through account -> project -> output
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
  # Where per-target publication files go inside the archive. The directory is PreTeXt's
  # default for <project @publication>, which is why nothing declares it.
  PUBLICATION_DIR = "publication".freeze

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

      # The project's own options, under the name PreTeXt falls back to. Nothing in this
      # archive points at it -- every target names its own file -- but a target someone
      # adds by hand to a downloaded copy lands here, and should get the project's
      # settings rather than PreTeXt's bare defaults.
      zip.put_next_entry("#{PUBLICATION_DIR}/publication.ptx")
      zip.write(publication_ptx(@project))

      @project.targets.each do |target|
        zip.put_next_entry("#{PUBLICATION_DIR}/#{publication_filename(target)}")
        zip.write(publication_ptx(target))
      end

      zip.put_next_entry("source/main.ptx")
      zip.write(@project.pretext_source.to_s)

      @project.assets.each do |asset|
        next unless asset.file.attached?

        zip.put_next_entry("source/external/#{asset.external_filename}")
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

  # The publisher options for one project or one target, resolved through account ->
  # project -> output and rendered as a publication file. Public so the settings modal can
  # show an author exactly what a build will be handed.
  def publication_ptx(owner)
    PublicationFileBuilder.new(Publication::Settings.effective_for(owner)).to_xml
  end

  private

    # The target's publication file, named for the same slug everything else about it is.
    #
    # Bare, with no directory: @publication on a <target> resolves relative to the
    # project's publication directory, not the project root (Target.publication_abspath in
    # PreTeXtBook/pretext-cli). "publication/website.ptx" here would send the CLI looking
    # in publication/publication/, and fail every build.
    def publication_filename(target)
      "#{target.slug}.ptx"
    end

    # `manifest_attributes` is whatever the target's kind decided it emits (a SCORM
    # package contributes both format and compression), plus any per-target options. The
    # three attributes named here are ours rather than the kind's: output-dir because
    # FullBuildArtifactJob strips exactly this prefix, output-filename because fixing it
    # to the slug is what makes a single-file artifact's path knowable up front, and
    # publication because each target gets its own file (see publication_filename).
    #
    # @name is the target's slug, not its display name: this is what `pretext build <x>`
    # takes on a downloaded copy, and the schema will not accept "Instructor edition".
    def target_element(target)
      attributes = {
        "name" => target.slug
      }.merge(target.manifest_attributes).merge(
        "output-dir" => target.slug,
        "output-filename" => target.output_filename,
        "publication" => publication_filename(target)
      ).compact

      pairs = attributes.map { |key, value| %(#{key}="#{ERB::Util.html_escape(value)}") }
      "<target #{pairs.join(' ')} />"
    end
end
