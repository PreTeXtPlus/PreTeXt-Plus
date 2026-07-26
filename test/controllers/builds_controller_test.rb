require "test_helper"

class BuildsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @project = projects(:one)
    @target = targets(:one_print) # no builds in flight, unlike one_web
    @user = users(:one)
    sign_in @user
  end

  # The permission change that makes the dashboard worth having: building used to be
  # admin-only.
  test "a project owner who is not an admin can start a build" do
    assert_not @user.admin?

    assert_difference("@target.builds.count") do
      post project_target_builds_url(@project, @target)
    end
  end

  test "starting a build enqueues it" do
    assert_enqueued_with(job: FullBuildJob) do
      post project_target_builds_url(@project, @target)
    end
  end

  test "a turbo_stream request swaps the row in place instead of navigating" do
    post project_target_builds_url(@project, @target),
         headers: { "Accept" => "text/vnd.turbo-stream.html" }

    assert_response :success
    assert_match "turbo-stream", response.media_type
    assert_match ActionView::RecordIdentifier.dom_id(@target), response.body
    assert_match "Building", response.body
  end

  test "a plain request falls back to the dashboard" do
    post project_target_builds_url(@project, @target)
    assert_redirected_to project_url(@project)
  end

  test "cannot build into another user's project" do
    assert_no_difference("Build.count") do
      post project_target_builds_url(projects(:two), targets(:two_web))
    end

    # ApplicationController rescues CanCan::AccessDenied into a redirect.
    assert_redirected_to projects_path
    assert flash[:alert].present?
  end

  # Two independent bounds on build spend. Fixtures already leave user one with two
  # in-flight builds on one_web, so the cap bites on the second new build.
  test "a user may not exceed the concurrent build cap" do
    in_flight = Build.where(project_id: @user.project_ids,
                            status: Build.statuses.values_at(*Target::IN_FLIGHT)).count
    assert_equal 2, in_flight, "fixtures should leave exactly two builds in flight"

    post project_target_builds_url(@project, @target)
    assert_redirected_to project_url(@project)

    assert_no_difference("Build.count") do
      post project_target_builds_url(@project, @target)
    end
    assert_match(/builds running/, flash[:alert])
  end

  test "the concurrency cap counts only the current user's builds" do
    # users(:two) has one in-flight build of their own; user one's should not count.
    sign_in users(:two)
    assert_difference("Build.count") do
      post project_target_builds_url(projects(:two), targets(:two_web))
    end
  end

  test "the build log page is reachable and shows the log" do
    build = builds(:one)
    build.update_column(:log, "ERROR external/fig-hasse.svg not found")

    get project_build_url(@project, build)

    assert_response :success
    assert_match "fig-hasse.svg", response.body
  end

  test "deleting a build returns to the target drawer" do
    build = builds(:one)
    assert_difference("Build.count", -1) do
      delete project_build_url(@project, build)
    end
    assert_redirected_to project_target_url(@project, build.target)
  end
end
