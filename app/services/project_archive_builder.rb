require "zip"
require "stringio"
require "nokogiri"

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
#                                   with every <plus:* ref/> placeholder resolved),
#                                   plus the external-directory declaration below
#   source/external/<ref>.<ext>  -- each project asset, matching the bare
#                                   `<image source="<ref>.<ext>">` the editor emits
#
# NOTE: the external-directory placement (source/external) is declared to PreTeXt by
# main_ptx below. If the full server resolves images elsewhere, that is the one
# value to adjust.
class ProjectArchiveBuilder
  # Where per-target publication files go inside the archive. The directory is PreTeXt's
  # default for <project @publication>, which is why nothing declares it.
  PUBLICATION_DIR = "publication".freeze

  # The directory, relative to source/main.ptx, that a project's assets are packed into --
  # and so the value main_ptx declares to PreTeXt. One constant because `build` writing
  # assets somewhere else than the document says to look is a silent failure: every image
  # simply goes missing from the output.
  EXTERNAL_DIR = "external".freeze

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
      zip.write(main_ptx)

      @project.assets.each do |asset|
        next unless asset.file.attached?

        zip.put_next_entry("source/#{EXTERNAL_DIR}/#{asset.external_filename}")
        zip.write(asset.file.download)
      end

      # Both extensions: new projects' docinfo points at icon.svg, but a
      # project created before that default changed still has icon.png
      # baked into its own persisted docinfo (docinfo is only ever set from
      # the current template at creation time, never regenerated), so
      # either reference has to resolve without a data migration.
      unless @project.icon_asset
        %w[ svg png ].each do |ext|
          zip.put_next_entry("source/#{EXTERNAL_DIR}/icon.#{ext}")
          zip.write(File.read Rails.root.join("public", "icon.#{ext}"))
        end
      end
    end
    buffer.rewind
    buffer
  end

  # The author's document as the archive ships it: their own <pretext>, with the external
  # directory declared inside <docinfo>.
  #
  # That declaration used to be ours to write into every publication file. PreTeXt moved it
  # into docinfo on 2026-07-30 (publisher-variables.xsl, $external-directory-source) on the
  # grounds that a different directory of files is a different document -- true of documents
  # in general, and not true here: the directory is wherever `build` above put the assets,
  # which is EXTERNAL_DIR and nothing else.
  #
  # So it is written onto a copy at pack time rather than into the docinfo an author edits.
  # They neither have to add it nor can break it by deleting it, and one already there is
  # overwritten rather than honored -- a project whose docinfo said "images" would build
  # with every image missing, which is not a preference worth preserving.
  #
  # Source we cannot parse is passed through untouched. It will fail the build either way,
  # and it fails more usefully as the author's own text than as whatever we recovered.
  def main_ptx
    source = @project.pretext_source.to_s
    document = Nokogiri::XML(source)
    return source if document.root.nil?

    declare_external_directory(document)
    document.encoding = "UTF-8"
    # AS_XML without FORMAT: libxml2's pretty-printer reindents any element whose children
    # are all elements, and PreTeXt reads whitespace inside some of them. The only bytes
    # that change are the ones added below.
    document.to_xml(save_with: Nokogiri::XML::Node::SaveOptions::AS_XML)
  end

  # The publisher options for one project or one target, resolved through account ->
  # project -> output and rendered as a publication file. Public so the settings modal can
  # show an author exactly what a build will be handed.
  def publication_ptx(owner)
    PublicationFileBuilder.new(Publication::Settings.effective_for(owner)).to_xml
  end

  private

    # Puts `directories/@external` inside `<docinfo>`, adding whichever of the two elements
    # the document is missing. <docinfo> goes first among <pretext>'s children, which is
    # where the schema wants it and where the editor already writes it.
    def declare_external_directory(document)
      docinfo = document.root.at_xpath("./docinfo") ||
        document.root.prepend_child("\n  <docinfo>\n  </docinfo>").last

      directories = docinfo.at_xpath("./directories") ||
        docinfo.prepend_child("\n    <directories/>").last

      directories["external"] = EXTERNAL_DIR
    end

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
