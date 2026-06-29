require "test_helper"

class BuildFileTest < ActiveSupport::TestCase
  test "belongs to build" do
    assert_equal builds(:one), build_files(:index).build
  end

  test "relative_path must be present" do
    bf = BuildFile.new(build: builds(:one), relative_path: "")
    assert_not bf.valid?
    assert_includes bf.errors[:relative_path], "can't be blank"
  end

  test "relative_path must be unique within a build" do
    bf = BuildFile.new(build: builds(:one), relative_path: "index.html")
    assert_not bf.valid?
    assert_includes bf.errors[:relative_path], "has already been taken"
  end

  test "relative_path can repeat across different builds" do
    bf = BuildFile.new(build: builds(:two), relative_path: "chapter-one.html")
    assert bf.valid?
  end
end
