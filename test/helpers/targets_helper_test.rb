require "test_helper"

class TargetsHelperTest < ActionView::TestCase
  test "bulk_build_label is Build all when a target has never been built" do
    assert_equal "Build all", bulk_build_label([ targets(:one_web), targets(:one_print) ])
  end

  test "bulk_build_label is Rebuild outdated when nothing is unbuilt but something is stale" do
    target = targets(:one_print)
    build = target.builds.create!(created_at: 2.days.ago)
    build.mark!(:success)
    projects(:one).update_column(:source_updated_at, 1.hour.ago)

    assert_equal "Rebuild outdated", bulk_build_label([ target.reload ])
  end

  test "bulk_build_label is nil when nothing needs it" do
    assert_nil bulk_build_label([ targets(:one_web), targets(:two_web) ])
  end

  test "build_history_pill labels a queued build Queued" do
    target = targets(:one_print)
    build = target.builds.create!(status: :queued)

    assert_match "Queued", build_history_pill(build, target)
  end

  test "target_timing says a queued target with no prior build is waiting for a slot" do
    target = targets(:one_print)
    target.builds.create!(status: :queued)

    assert_match "Waiting for a build slot", target_timing(target.reload)
  end

  test "target_timing keeps the last build time for a queued rebuild of a published target" do
    target = targets(:two_web)
    target.builds.create!(status: :queued)

    text = target_timing(target.reload)
    assert_match "Built", text
    assert_match "Waiting for a build slot", text
  end
end
