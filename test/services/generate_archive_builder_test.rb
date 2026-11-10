require "test_helper"
require "zip"

# The one-figure archive a server-side render ships to `/generate`. The build server
# caches each generated figure under the md5 of its extracted source, which for an
# Asymptote figure includes the docinfo's preamble and macros -- so the document here
# must carry the docinfo exactly as a full build's does, or the preview is a render
# the build then repeats. That equality is the test that matters.
class GenerateArchiveBuilderTest < ActiveSupport::TestCase
  setup do
    @project = projects(:template)
    @project.update!(docinfo: "<docinfo><macros>\\newcommand{\\R}{\\mathbb{R}}</macros><asymptote-preamble>import graph;</asymptote-preamble></docinfo>")
    @asset = Content.new(project: @project, kind: :authored_asset, source_format: "asymptote", ref: "circle",
                         title: "Circle", source: "size(3cm);\ndraw(unitcircle);\nlabel(\"$a < b$\", (0,0));")
  end

  def entries(io)
    {}.tap do |map|
      Zip::File.open_buffer(io) do |zip|
        zip.each { |e| map[e.name] = e.get_input_stream.read if e.file? }
      end
    end
  end

  def docinfo_of(document)
    document[%r{<docinfo>.*</docinfo>}m]
  end

  def skip_without_bundle
    skip "assembler bundle not built -- run `npm run build:assembler`" unless SourceAssembler::BUNDLE.exist?
  end

  test "the manifest declares one html target, the one the render is for" do
    manifest = GenerateArchiveBuilder.new(@project, @asset).project_ptx
    assert_equal 1, manifest.scan("<target ").length
    assert_match(/<target [^>]*name="web"[^>]*format="html"/, manifest)
  end

  # The publication file declares an `external` directory, and the CLI refuses a
  # project without one (the first render against the real build server failed on
  # exactly that), so the archive carries what a full build's does there: the logo.
  test "the archive has the full build's layout, with the project's publication file and its external directory" do
    skip_without_bundle
    contents = entries(GenerateArchiveBuilder.new(@project, @asset).build)

    logo = "source/external/#{PublicationFileBuilder::DEFAULT_BRANDLOGO}"
    assert_equal %W[ project.ptx publication/publication.ptx publication/web.ptx source/main.ptx #{logo} ].sort,
                 contents.keys.sort
    assert_equal ProjectArchiveBuilder.new(@project).publication_ptx(@project), contents["publication/web.ptx"]
    assert_equal entries(ProjectArchiveBuilder.new(@project).build)[logo], contents[logo]
  end

  test "the document holds the one asset, in its generator's element, with the source as XML text" do
    skip_without_bundle
    document = entries(GenerateArchiveBuilder.new(@project, @asset).build)["source/main.ptx"]

    assert_includes document, %(<asymptote label="circle">\nsize(3cm);\ndraw(unitcircle);\nlabel("$a &lt; b$", (0,0));\n</asymptote>)
    assert_equal 1, document.scan("<image").length
    # Nothing of the project's own content: the archive is the one figure.
    assert_not_includes document, "Starter content"
  end

  # The property the build server's cache depends on. The common docinfo is the
  # case most likely to drift, so it is the one exercised.
  test "the document's docinfo is byte-identical to the full build's" do
    skip_without_bundle
    @project.user.update!(common_docinfo: "<docinfo><macros>\\def\\shared{1}</macros><asymptote-preamble>import graph;</asymptote-preamble></docinfo>")
    @project.update!(use_common_docinfo: true)
    @project.reload

    full = SourceAssembler.new(@project).call
    single = entries(GenerateArchiveBuilder.new(@project, @asset).build)["source/main.ptx"]

    assert_includes full, "\\shared"
    assert_equal docinfo_of(full), docinfo_of(single)
  end

  test "a source that will not assemble raises rather than shipping an archive" do
    raiser = Struct.new(:noop) do
      def call = raise(SourceAssembler::AssemblyError, "boom")
    end
    SourceAssembler.stub(:single_image, ->(_p, _a) { raiser.new }) do
      assert_raises(SourceAssembler::AssemblyError) { GenerateArchiveBuilder.new(@project, @asset).build }
    end
  end
end
