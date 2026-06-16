require "test_helper"

class DivisionTest < ActiveSupport::TestCase
  test "ref must be unique among project assets in the same project" do
    project = projects(:one)
    library_asset = LibraryAsset.create!(user: users(:one), kind: :file)
    ProjectAsset.create!(project: project, library_asset: library_asset, ref: "taken_ref")

    division = Division.new(project: project, ref: "taken_ref", source_format: :pretext)

    assert_not division.valid?
    assert_includes division.errors[:ref], "has already been taken"
  end
end
