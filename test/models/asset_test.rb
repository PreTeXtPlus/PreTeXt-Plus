require "test_helper"

class AssetTest < ActiveSupport::TestCase
  test "url returns the attached file's url when a file is attached" do
    asset = assets(:image_one)
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
    asset = assets(:authored_one)

    assert_equal "/image-not-found.svg", asset.url
  end

  test "ref must be unique among divisions in the same project" do
    project = projects(:one)
    Division.create!(project: project, ref: "taken_ref", source_format: :pretext, is_root: false)

    asset = Asset.new(project: project, ref: "taken_ref", kind: :file)

    assert_not asset.valid?
    assert_includes asset.errors[:ref], "has already been taken"
  end

  test "full_dup gives the copy an independent asset row that shares the original's file blob" do
    project = projects(:one)
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png", content_type: "image/png"
    )

    copy = project.full_dup(users(:two))
    copy.save!

    copied_asset = copy.assets.find_by!(ref: asset.ref)
    assert_not_equal asset.id, copied_asset.id
    assert copied_asset.file.attached?
    assert_equal asset.file.blob, copied_asset.file.blob
  end
end
