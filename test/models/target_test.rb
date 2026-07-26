require "test_helper"

class TargetTest < ActiveSupport::TestCase
  test "belongs to a project and has many builds" do
    target = targets(:two_web)
    assert_equal projects(:two), target.project
    assert_includes target.builds, builds(:two)
    assert_includes target.builds, builds(:failed)
  end

  test "name must be unique within a project but not across projects" do
    duplicate = Target.new(project: projects(:one), name: "web", output_format: :html)
    assert_not duplicate.valid?

    other_project = Target.new(project: projects(:two), name: "instructor", output_format: :html)
    assert other_project.valid?
  end

  # The decision that shapes the schema: `name` is the unique key, not `output_format`,
  # matching how PreTeXt-CLI treats <targets> in project.ptx.
  test "two targets in one project may share an output format" do
    assert_equal "html", targets(:one_web).output_format
    assert_equal "html", targets(:one_instructor).output_format
    assert_equal projects(:one), targets(:one_instructor).project
  end

  test "name must be a legal PreTeXt target name" do
    assert_not Target.new(project: projects(:one), name: "not a ref", output_format: :html).valid?
    assert_not Target.new(project: projects(:one), name: "", output_format: :html).valid?
    assert Target.new(project: projects(:one), name: "web-2", output_format: :html).valid?
  end

  test "display_label falls back to a humanized name" do
    assert_equal "Website", targets(:one_web).display_label
    assert_equal "Print", targets(:one_print).display_label
  end

  test "latest_build is the newest by created_at, not the newest successful" do
    assert_equal builds(:failed), targets(:two_web).latest_build
  end

  # ---- state ----

  test "state is never when the target has no successful build" do
    assert_equal :never, targets(:one_print).state
  end

  test "state is building whenever any build is in flight" do
    assert_equal :building, targets(:one_web).state
  end

  test "in-flight covers every status the build server might still answer for" do
    target = targets(:one_print)
    Target::IN_FLIGHT.each do |status|
      build = target.builds.create!(status: status)
      assert_equal :building, target.reload.state, "expected #{status} to read as building"
      build.destroy!
    end
  end

  test "state is failed when the last attempt failed, even though output is still live" do
    target = targets(:two_web)
    assert_equal :failed, target.state
    # The whole point: readers keep seeing the last good build.
    assert_equal builds(:two), target.current_build
  end

  test "state is current when the successful build is newer than the last source edit" do
    target = targets(:one_print)
    projects(:one).update_column(:source_updated_at, 2.days.ago)
    build = target.builds.create!(created_at: 1.hour.ago)
    build.mark!(:success)

    assert_equal :current, target.reload.state
    assert_not target.stale?
  end

  test "state is stale when the source changed after the successful build" do
    target = targets(:one_print)
    build = target.builds.create!(created_at: 2.days.ago)
    build.mark!(:success)
    projects(:one).update_column(:source_updated_at, 1.hour.ago)

    assert_equal :stale, target.reload.state
    assert target.stale?
  end

  # ---- current_build bookkeeping ----

  test "adopt! promotes a successful build and ignores everything else" do
    target = targets(:one_print)
    assert_nil target.current_build_id

    failed = target.builds.create!
    failed.mark!(:failed)
    assert_nil target.reload.current_build_id

    ok = target.builds.create!
    ok.mark!(:success)
    assert_equal ok, target.reload.current_build
    assert_equal ok.created_at, target.last_built_at
  end

  test "destroying the current build falls back to the previous successful one" do
    target = targets(:one_print)
    older = target.builds.create!(created_at: 2.days.ago)
    older.mark!(:success)
    newer = target.builds.create!(created_at: 1.day.ago)
    newer.mark!(:success)
    assert_equal newer, target.reload.current_build

    newer.destroy!
    assert_equal older, target.reload.current_build
  end

  test "destroying the only successful build clears the pointer" do
    target = targets(:two_web)
    assert_equal builds(:two), target.current_build

    builds(:two).destroy!

    assert_nil target.reload.current_build_id
    assert_nil target.last_built_at
  end

  test "destroying a target destroys its builds" do
    target = targets(:two_web)
    build_ids = target.builds.pluck(:id)
    assert build_ids.any?

    target.destroy!

    assert_empty Build.where(id: build_ids)
  end
end
