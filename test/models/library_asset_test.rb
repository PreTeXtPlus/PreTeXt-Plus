require "test_helper"

class LibraryAssetTest < ActiveSupport::TestCase
  test "url returns the attached file's url when a file is attached" do
    asset = library_assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )

    ActiveStorage::Current.url_options = { host: "example.com" }
    travel_to Time.current do
      assert_equal asset.file.url(expires_in: 1.hour), asset.url
    end
  end

  test "url is the placeholder image when no file is attached" do
    asset = library_assets(:authored_one)

    assert_equal "/image-not-found.svg", asset.url
  end
end
