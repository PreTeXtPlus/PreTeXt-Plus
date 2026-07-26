require "test_helper"
require "zip"

class ProjectArchiveBuilderTest < ActiveSupport::TestCase
  def entries(io)
    {}.tap do |map|
      Zip::File.open_buffer(io) do |zip|
        zip.each { |e| map[e.name] = e.get_input_stream.read if e.file? }
      end
    end
  end

  test "includes project.ptx and publication and puts pretext_source at source/main.ptx" do
    project = projects(:one)
    project.update_column(:pretext_source, "<pretext><article/></pretext>")

    contents = entries(ProjectArchiveBuilder.new(project).build)

    assert_includes contents.keys, "project.ptx"
    assert_includes contents.keys, "publication/publication.ptx"
    assert_equal "<pretext><article/></pretext>", contents["source/main.ptx"]
  end

  # The manifest lists every target, so one archive serves any build request and a
  # downloaded project can `pretext build <name>` for all of them.
  test "the manifest declares every target the project has" do
    project = projects(:one)
    manifest = ProjectArchiveBuilder.new(project).project_ptx

    project.targets.each do |target|
      assert_includes manifest, %(name="#{target.name}")
    end
    assert_equal project.targets.count, manifest.scan("<target ").length
  end

  # output-dir is explicit because FullBuildArtifactJob strips exactly that prefix off
  # the entries the build server returns.
  test "every target declares an output-dir matching its name" do
    manifest = ProjectArchiveBuilder.new(projects(:one)).project_ptx

    projects(:one).targets.each do |target|
      assert_match(/<target [^>]*name="#{target.name}"[^>]*output-dir="#{target.name}"/, manifest)
    end
  end

  # Naming the artifact means its path is known before the build runs, which is what
  # lets a pdf target be published without first discovering the filename.
  test "single-file formats ask for a named output file" do
    project = projects(:one)
    manifest = ProjectArchiveBuilder.new(project).project_ptx

    assert_match(/<target [^>]*name="print"[^>]*output-filename="print\.pdf"/, manifest)
    # html is a directory of files, so there is nothing to name.
    assert_no_match(/<target [^>]*name="web"[^>]*output-filename/, manifest)
  end

  # PreTeXt's schema has no `scorm` format -- it is html plus compression.
  test "compression is emitted for a scorm package" do
    project = projects(:one)
    project.targets.create!(name: "lms", output_format: :html, compression: "scorm")

    manifest = ProjectArchiveBuilder.new(project).project_ptx

    assert_match(/<target [^>]*name="lms"[^>]*format="html"[^>]*compression="scorm"/, manifest)
  end

  test "every emitted format is one the PreTeXt schema accepts" do
    project = projects(:one)
    valid = %w[ html pdf latex epub kindle braille revealjs webwork custom ]

    Target.output_formats.each_key do |format|
      assert_includes valid, format,
        "Target declares #{format.inspect}, which project.ptx would reject"
    end
  end

  test "packs each asset with a file under source/external using its ref" do
    project = projects(:one)
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )

    contents = entries(ProjectArchiveBuilder.new(project).build)

    path = "source/external/#{asset.ref}.png"
    assert_includes contents.keys, path
    assert_equal asset.file.download, contents[path]
  end
end
