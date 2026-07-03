require "test_helper"

class BuildTest < ActiveSupport::TestCase
  test "belongs to project" do
    assert_equal projects(:one), builds(:one).project
  end

  test "default status is pending" do
    build = Build.new(project: projects(:one))
    assert build.pending?
  end

  test "all status values round-trip" do
    assert builds(:one).pending?
    assert builds(:in_progress).in_progress?
    assert builds(:two).success?
    assert builds(:failed).failed?
  end

  test "status transitions via bang methods" do
    build = builds(:one)
    build.in_progress!
    assert build.in_progress?
    build.success!
    assert build.success?
    build.failed!
    assert build.failed?
  end

  test "invalid status is rejected" do
    build = Build.new(project: projects(:one), status: 99)
    assert_not build.valid?
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
end
