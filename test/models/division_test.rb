require "test_helper"

class DivisionTest < ActiveSupport::TestCase
  test "ref must be unique among assets in the same project" do
    project = projects(:one)
    Asset.create!(project: project, ref: "taken_ref", kind: :file)

    division = Division.new(project: project, ref: "taken_ref", source_format: :pretext)

    assert_not division.valid?
    assert_includes division.errors[:ref], "has already been taken"
  end
end
