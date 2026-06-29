require "test_helper"

class BuildTest < ActiveSupport::TestCase
  test "belongs to project" do
    assert_equal projects(:one), builds(:one).project
  end

  test "has many build_files" do
    build = builds(:one)
    assert_includes build.build_files, build_files(:index)
    assert_includes build.build_files, build_files(:chapter)
  end

  test "destroying a build destroys its build_files" do
    build = builds(:one)
    file_ids = build.build_files.pluck(:id)
    assert file_ids.any?
    build.destroy!
    assert_empty BuildFile.where(id: file_ids)
  end

  test "file_at with blank path returns index.html" do
    build = builds(:one)
    assert_equal build_files(:index), build.file_at(nil)
    assert_equal build_files(:index), build.file_at("")
  end

  test "file_at returns exact path match" do
    build = builds(:one)
    assert_equal build_files(:chapter), build.file_at("chapter-one.html")
  end

  test "file_at finds path with .html appended" do
    build = builds(:one)
    assert_equal build_files(:chapter), build.file_at("chapter-one")
  end

  test "file_at finds path with /index.html appended" do
    build = builds(:one)
    assert_equal build_files(:nested_index), build.file_at("appendix")
  end

  test "file_at returns nil when no file matches" do
    assert_nil builds(:one).file_at("nonexistent")
  end

  test "file_at only searches within its own build" do
    assert_nil builds(:one).file_at("other-build-only.html")
  end
end
