require "test_helper"

class ProjectAssetTest < ActiveSupport::TestCase
  test "ref must be unique among divisions in the same project" do
    project = projects(:one)
    Division.create!(project: project, ref: "taken_ref", source_format: :pretext, is_root: false)
    library_asset = LibraryAsset.create!(user: users(:one), kind: :file)

    project_asset = ProjectAsset.new(project: project, library_asset: library_asset, ref: "taken_ref")

    assert_not project_asset.valid?
    assert_includes project_asset.errors[:ref], "has already been taken"
  end

  test "reassigning to a project owned by a different user duplicates the library asset's file" do
    library_asset = library_assets(:image_one)
    library_asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )
    other_project = projects(:two)

    project_asset = ProjectAsset.create!(project: other_project, library_asset: library_asset, ref: "reassigned_ref")

    new_library_asset = project_asset.reload.library_asset
    assert_not_equal library_asset, new_library_asset
    assert new_library_asset.file.attached?
    assert_equal library_asset.file.blob, new_library_asset.file.blob
  end
end
