require "test_helper"

class SnippetTest < ActiveSupport::TestCase
  test "ref must be unique among divisions in the same project" do
    project = projects(:one)
    project.divisions.create!(ref: "taken_ref", source_format: :pretext)

    snippet = Snippet.new(project: project, ref: "taken_ref", source_format: :pretext)

    assert_not snippet.valid?
    assert_includes snippet.errors[:ref], "has already been taken"
  end

  test "ref must be unique among assets in the same project" do
    project = projects(:one)
    Asset.create!(project: project, ref: "taken_ref", kind: :file)

    snippet = Snippet.new(project: project, ref: "taken_ref", source_format: :pretext)

    assert_not snippet.valid?
    assert_includes snippet.errors[:ref], "has already been taken"
  end

  test "ref must be unique among other snippets in the same project" do
    project = projects(:one)
    project.snippets.create!(ref: "taken_ref", source_format: :pretext)

    snippet = Snippet.new(project: project, ref: "taken_ref", source_format: :pretext)

    assert_not snippet.valid?
    assert_includes snippet.errors[:ref], "has already been taken"
  end

  test "a division's ref is rejected once a snippet already holds it" do
    project = projects(:one)
    project.snippets.create!(ref: "taken_ref", source_format: :pretext)

    division = Division.new(project: project, ref: "taken_ref", source_format: :pretext)

    assert_not division.valid?
    assert_includes division.errors[:ref], "has already been taken"
  end

  test "an asset's ref is rejected once a snippet already holds it" do
    project = projects(:one)
    project.snippets.create!(ref: "taken_ref", source_format: :pretext)

    asset = Asset.new(project: project, ref: "taken_ref", kind: :file)

    assert_not asset.valid?
    assert_includes asset.errors[:ref], "has already been taken"
  end

  test "is valid with a unique ref" do
    project = projects(:one)

    snippet = Snippet.new(project: project, ref: "unique_ref", source_format: :pretext, source: "hello")

    assert snippet.valid?
  end
end
