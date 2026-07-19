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
