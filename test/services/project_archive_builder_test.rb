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
    assert_includes contents["project.ptx"], %(name="#{ProjectArchiveBuilder::TARGET}")
  end

  test "packs each project_asset with a file under source/external using its ref" do
    project = projects(:one)
    library_asset = library_assets(:image_one)
    library_asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )

    contents = entries(ProjectArchiveBuilder.new(project).build)

    path = "source/external/#{project_assets(:one).ref}.png"
    assert_includes contents.keys, path
    assert_equal library_asset.file.download, contents[path]
  end

  test "skips project_assets whose library_asset has no file" do
    project = projects(:one)

    contents = entries(ProjectArchiveBuilder.new(project).build)

    assert contents.keys.none? { |k| k.start_with?("source/external/") }
  end
end
