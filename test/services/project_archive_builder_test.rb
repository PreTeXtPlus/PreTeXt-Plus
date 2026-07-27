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
  # downloaded project can `pretext build <slug>` for all of them. @name is the slug: the
  # schema would not take "Instructor edition", and the CLI has to be able to echo it back.
  test "the manifest declares every target the project has" do
    project = projects(:one)
    manifest = ProjectArchiveBuilder.new(project).project_ptx

    project.targets.each do |target|
      assert_includes manifest, %(name="#{target.slug}")
    end
    assert_equal project.targets.count, manifest.scan("<target ").length
  end

  # output-dir is explicit because FullBuildArtifactJob strips exactly that prefix off
  # the entries the build server returns.
  test "every target declares an output-dir matching its slug" do
    manifest = ProjectArchiveBuilder.new(projects(:one)).project_ptx

    projects(:one).targets.each do |target|
      assert_match(/<target [^>]*name="#{target.slug}"[^>]*output-dir="#{target.slug}"/, manifest)
    end
  end

  # Naming the artifact means its path is known before the build runs, which is what
  # lets a pdf target be published without first discovering the filename.
  test "single-file formats ask for a named output file" do
    project = projects(:one)
    manifest = ProjectArchiveBuilder.new(project).project_ptx

    assert_match(/<target [^>]*name="print"[^>]*output-filename="print\.pdf"/, manifest)
    # html is a directory of files, so there is nothing to name.
    assert_no_match(/<target [^>]*name="website"[^>]*output-filename/, manifest)
  end

  # PreTeXt's schema has no `scorm` format -- it is html plus compression. The author
  # picked one thing; the manifest gets both attributes.
  test "a scorm target emits format and compression together" do
    project = projects(:one)
    project.targets.create!(name: "LMS package", kind: "scorm")

    manifest = ProjectArchiveBuilder.new(project).project_ptx

    assert_match(/<target [^>]*name="lms-package"[^>]*format="html"[^>]*compression="scorm"/, manifest)
  end

  # Per-target tuning reaches the manifest without the catalog needing a variant for
  # every combination, and without a column per PreTeXt attribute.
  test "options are emitted as attributes alongside what the kind emits" do
    project = projects(:one)
    project.targets.create!(name: "Big", kind: "pdf", options: { "asy-method" => "server" })

    manifest = ProjectArchiveBuilder.new(project).project_ptx

    assert_match(/<target [^>]*name="big"[^>]*asy-method="server"/, manifest)
    assert_match(/<target [^>]*name="big"[^>]*format="pdf"/, manifest)
  end

  # The guard that keeps the catalog honest: a kind whose `emits` names a format PreTeXt
  # does not have would produce a manifest the CLI rejects, failing every build of it.
  test "every format the catalog can emit is one the PreTeXt schema accepts" do
    valid = %w[ html pdf latex epub kindle braille revealjs beamer webwork custom ]

    Target::Catalog.all.each do |kind|
      assert_includes valid, kind.emits["format"],
        "#{kind.slug} emits format=#{kind.emits['format'].inspect}, which project.ptx would reject"
    end
  end

  # `options` is free-form and will eventually be author-editable, so it must not be able
  # to reach the attributes the builder derives from the row. Renaming a target through
  # that back door would move its output directory out from under the artifact job and
  # break its published URL.
  test "options cannot override the attributes the builder owns" do
    project = projects(:one)
    project.targets.create!(
      name: "Sneaky", kind: "pdf",
      options: { "name" => "elsewhere", "output-dir" => "../etc", "output-filename" => "x.pdf" }
    )

    manifest = ProjectArchiveBuilder.new(project).project_ptx

    assert_match(/<target [^>]*name="sneaky"[^>]*output-dir="sneaky"[^>]*output-filename="sneaky\.pdf"/, manifest)
    assert_no_match(/elsewhere|\.\.\/etc/, manifest)
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
