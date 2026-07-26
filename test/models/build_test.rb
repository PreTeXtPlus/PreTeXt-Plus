require "test_helper"

class BuildTest < ActiveSupport::TestCase
  test "belongs to project" do
    assert_equal projects(:one), builds(:one).project
  end

  test "belongs to target" do
    assert_equal targets(:one_web), builds(:one).target
  end

  test "project is inherited from the target when not given" do
    build = Build.create!(target: targets(:one_instructor))
    assert_equal projects(:one), build.project
  end

  test "default status is pending" do
    build = Build.new(target: targets(:one_web))
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
    build = Build.new(target: targets(:one_web), status: 99)
    assert_not build.valid?
  end

  # ---- mark! ----
  #
  # The single funnel for status transitions. Every job and controller goes through it so
  # that promoting a finished build (and, from PR 2, broadcasting the row) cannot be
  # forgotten at a new transition site.

  test "mark! sets the status and any extra columns" do
    build = builds(:one)
    build.mark!(:failed, log: "boom")

    assert build.reload.failed?
    assert_equal "boom", build.log
  end

  test "mark! rejects a status that is not in the enum" do
    assert_raises(KeyError) { builds(:one).mark!(:exploded) }
  end

  test "mark!(:success) promotes the build on its target" do
    build = builds(:one)
    assert_nil build.target.current_build_id

    build.mark!(:success)

    assert_equal build, build.target.reload.current_build
    assert_equal build.created_at, build.target.last_built_at
  end

  test "mark!(:failed) leaves an already-published output in place" do
    target = targets(:two_web)
    assert_equal builds(:two), target.current_build

    target.builds.create!.mark!(:failed)

    assert_equal builds(:two), target.reload.current_build
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
