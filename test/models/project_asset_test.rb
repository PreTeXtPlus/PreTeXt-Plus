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
end
