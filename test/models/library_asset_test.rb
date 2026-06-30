require "test_helper"

class LibraryAssetTest < ActiveSupport::TestCase
  test "external_filename includes extension when file is attached" do
    asset = library_assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )

    assert_equal "#{asset.id}.png", asset.external_filename
  end

  test "external_filename is bare id when no file is attached" do
    asset = library_assets(:authored_one)

    assert_equal asset.id.to_s, asset.external_filename
  end
end
