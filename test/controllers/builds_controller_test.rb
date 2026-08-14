require "test_helper"

class BuildsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @project = projects(:one)
    @target = targets(:one_print) # no builds in flight, unlike one_web
    @user = users(:one)
    sign_in @user
  end

  # The build server's cancel endpoint, stood in for by its two outcomes that matter:
  # it stopped the job, or it could not.
  def stub_cancel(outcome, &blk)
    klass, code = outcome == :ok ? [ Net::HTTPOK, "200" ] : [ Net::HTTPInternalServerError, "500" ]
    response = klass.new("1.1", code, "")
    response.instance_variable_set(:@read, true)
    response.define_singleton_method(:body) { "" }

    Net::HTTP.stub(:start, ->(*_args, **_kw) { response }, &blk)
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
    # Fixtures already leave user one at their non-subscriber cap of 1 (two builds in
    # flight on one_web); admin so this build starts immediately rather than queuing --
    # queuing on start is its own scenario below, this test is about the enqueue.
    @user.update!(admin: true)

    assert_enqueued_with(job: FullBuildJob) do
      post project_target_builds_url(@project, @target)
    end
  end

  test "a turbo_stream request swaps the row in place instead of navigating" do
    @user.update!(admin: true) # see "starting a build enqueues it"

    post project_target_builds_url(@project, @target),
         headers: { "Accept" => "text/vnd.turbo-stream.html" }

    assert_response :success
    assert_match "turbo-stream", response.media_type
    assert_match ActionView::RecordIdentifier.dom_id(@target), response.body
    assert_match "Building", response.body
  end

  # Rebuilding from the drawer used to update only the row behind it, leaving the drawer
  # showing the old state and a Rebuild button for a build already running.
  test "rebuilding from the drawer redraws the drawer too" do
    @user.update!(admin: true) # see "starting a build enqueues it"

    post project_target_builds_url(@project, @target),
         headers: { "Turbo-Frame" => "drawer" },
         as: :turbo_stream

    assert_response :success
    assert_match(/turbo-stream[^>]*target="drawer"/, response.body)
    # And still swaps the row behind it into its building state.
    assert_match ActionView::RecordIdentifier.dom_id(@target), response.body
    assert_match "Building", response.body
  end

  # The dashboard carries an empty "drawer" frame of its own, so an unguarded replace
  # would pop the drawer open on anyone who rebuilt from a row.
  test "rebuilding from a row does not open the drawer" do
    post project_target_builds_url(@project, @target), as: :turbo_stream

    assert_response :success
    assert_no_match(/target="drawer"/, response.body)
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

  # Fixtures already leave user one with two in-flight builds on one_web -- already over
  # a non-subscriber's cap of 1 -- so the cap bites on the very first new build. "Bites"
  # means queues, not refuses.
  test "a build beyond the concurrency cap is queued instead of rejected" do
    in_flight = Build.where(project_id: @user.project_ids,
                            status: Build.statuses.values_at(*Target::IN_FLIGHT)).count
    assert_equal 2, in_flight, "fixtures should leave exactly two builds in flight"
    assert_equal 1, @user.max_concurrent_builds, "a non-subscriber's cap is 1"

    assert_difference("Build.count", 1) do
      assert_no_enqueued_jobs(only: FullBuildJob) do
        post project_target_builds_url(@project, @target)
      end
    end

    assert_redirected_to project_url(@project)
    assert @target.reload.latest_build.queued?
    assert_match(/queued/i, flash[:notice])
  end

  test "the concurrency cap counts only the current user's builds" do
    # users(:two) has one in-flight build of their own; user one's should not count.
    sign_in users(:two)
    assert_difference("Build.count") do
      post project_target_builds_url(projects(:two), targets(:two_web))
    end
  end

  # Same 5-vs-1 split as Project#collaborator_limit, proven end to end through the real
  # build-starting path rather than just against User#max_concurrent_builds directly.
  test "a subscriber may run more than one build at once" do
    sign_in users(:subscribed)
    project = projects(:public_project)
    first = project.targets.first
    second = project.targets.create!(kind: "pdf")

    post project_target_builds_url(project, first)
    post project_target_builds_url(project, second)

    assert first.reload.latest_build.pending?
    assert second.reload.latest_build.pending?,
      "a non-subscriber's second build would have queued behind the first"
  end

  # ---- build_all ----
  #
  # A subscriber-only feature (see Ability#build_all), so every scenario below runs as a
  # subscribed owner unless the test is specifically about the subscription gate itself.
  # one_web is already building; one_instructor and one_print have never been built.

  test "build_all starts as many candidates as fit and queues the rest" do
    subscription_seats(:one).update!(user: @user)
    # Fixtures leave two builds in flight; pad to four so exactly one of the
    # subscriber's five concurrent-build slots is free -- the first never-built target
    # in position order (one_instructor) starts and the second (one_print) queues.
    2.times { Build.create!(project: @project, target: targets(:one_web), status: :in_progress) }

    assert_difference("Build.count", 2) do
      post build_all_project_builds_url(@project)
    end

    assert_redirected_to project_url(@project)
    assert_match(/Started 1 build now/, flash[:notice])
    assert_match(/1 more is queued/, flash[:notice])
    assert targets(:one_instructor).reload.latest_build.pending?
    assert targets(:one_print).reload.latest_build.queued?
  end

  test "build_all queues everything when no slot is free" do
    subscription_seats(:one).update!(user: @user)
    # Fixtures leave two builds in flight; pad to five so the subscriber's cap is
    # already full before build_all runs.
    3.times { Build.create!(project: @project, target: targets(:one_web), status: :in_progress) }

    assert_difference("Build.count", 2) do
      assert_no_enqueued_jobs(only: FullBuildJob) do
        post build_all_project_builds_url(@project)
      end
    end

    assert_match(/Started 0 builds now/, flash[:notice])
    assert targets(:one_instructor).reload.latest_build.queued?
    assert targets(:one_print).reload.latest_build.queued?
  end

  test "build_all does nothing when nothing is unbuilt or outdated" do
    subscription_seats(:one).update!(user: users(:two))
    sign_in users(:two) # two_web's only build failed -- neither never nor stale

    assert_no_difference("Build.count") do
      post build_all_project_builds_url(projects(:two))
    end

    assert_redirected_to project_url(projects(:two))
    assert_match(/already built/i, flash[:alert])
  end

  test "build_all targets stale outputs once nothing is unbuilt" do
    subscription_seats(:one).update!(user: users(:two))
    sign_in users(:two)
    builds(:failed).destroy!
    projects(:two).update_column(:source_updated_at, 1.hour.ago)
    assert_equal :stale, targets(:two_web).reload.state

    assert_difference("Build.count", 1) do
      post build_all_project_builds_url(projects(:two))
    end

    assert_match(/Started 1 build now/, flash[:notice])
  end

  test "cannot build_all another user's project" do
    assert_no_difference("Build.count") do
      post build_all_project_builds_url(projects(:two))
    end

    assert_redirected_to projects_path
    assert flash[:alert].present?
  end

  test "build_all is refused for a non-subscribed owner" do
    assert_not @project.user.subscribed?

    assert_no_difference("Build.count") do
      post build_all_project_builds_url(@project)
    end

    assert_redirected_to projects_path
    assert flash[:alert].present?
  end

  test "a collaborator can build_all once the project owner is subscribed" do
    subscription_seats(:one).update!(user: @user) # @user (one) owns @project
    sign_in users(:two) # accepted collaborator on @project

    assert_difference("Build.count", 2) do
      post build_all_project_builds_url(@project)
    end

    assert_redirected_to project_url(@project)
    assert_match(/Started/, flash[:notice])
  end

  test "the build log page is reachable and shows the log" do
    build = builds(:one)
    build.update_column(:log, "ERROR external/fig-hasse.svg not found")

    get project_build_url(@project, build)

    assert_response :success
    assert_match "fig-hasse.svg", response.body
  end

  # Cancelling is what gives a concurrent-build slot back, so the cap has to see it go.
  test "cancelling a build frees its concurrency slot" do
    build = builds(:in_progress)
    build.update_column(:remote_status_url, "/builds/job-123")

    stub_cancel(:ok) { post cancel_project_build_url(@project, build) }

    assert build.reload.canceled?
    assert_redirected_to project_target_url(@project, build.target)
    assert_match(/canceled/i, flash[:notice])
  end

  test "cancelling a build that is not running says so" do
    build = builds(:in_progress)
    build.mark!(:success)

    post cancel_project_build_url(@project, build)

    assert_match(/already finished/, flash[:alert])
    assert build.reload.success?
  end

  test "a build server that refuses the cancel leaves the build running" do
    build = builds(:in_progress)
    build.update_column(:remote_status_url, "/builds/job-123")

    stub_cancel(:error) { post cancel_project_build_url(@project, build) }

    assert build.reload.in_progress?
    assert_match(/still be running/, flash[:alert])
  end

  test "cannot cancel a build in another user's project" do
    build = builds(:two)

    post cancel_project_build_url(projects(:two), build)

    assert_redirected_to projects_path
    assert flash[:alert].present?
  end

  test "deleting a build returns to the target drawer" do
    build = builds(:one)
    assert_difference("Build.count", -1) do
      delete project_build_url(@project, build)
    end
    assert_redirected_to project_target_url(@project, build.target)
  end
end
