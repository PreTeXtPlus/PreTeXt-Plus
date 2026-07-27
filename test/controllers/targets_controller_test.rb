require "test_helper"

class TargetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    @target = targets(:one_web)
    @user = users(:one)
    sign_in @user
  end

  test "the dashboard renders a row per target and no preview iframe" do
    get project_url(@project)

    assert_response :success
    @project.targets.each do |target|
      assert_select "##{ActionView::RecordIdentifier.dom_id(target)}"
    end
    assert_select "iframe", false, "the project page should no longer embed a preview"
  end

  test "the dashboard subscribes to its targets stream so builds update in place" do
    get project_url(@project)
    assert_select "turbo-cable-stream-source"
  end

  test "the dashboard reports the last edit, not the last rename" do
    @project.update_column(:source_updated_at, 5.days.ago)
    @project.update_column(:updated_at, Time.current)

    get project_url(@project)

    assert_match(/5 days/, response.body)
  end

  test "should show the drawer" do
    get project_target_url(@project, @target)

    assert_response :success
    assert_select "turbo-frame#drawer"
  end

  # The drawer is an overlay, and it used to be the *entire* body of this page: a
  # full-page visit -- the breadcrumb on a build log, the redirect after checking or
  # deleting a build, a bookmark -- got a panel floating over nothing, and closing it
  # emptied the document until the author reloaded.
  test "a full-page visit to a target renders the dashboard behind the drawer" do
    get project_target_url(@project, @target)

    assert_response :success
    assert_select "turbo-frame#drawer [data-controller=drawer]", 1
    # The project is really underneath, not just the chrome around it.
    @project.targets.each do |target|
      assert_select "##{ActionView::RecordIdentifier.dom_id(target)}"
    end
    assert_select "turbo-cable-stream-source"
  end

  # The other half of the same rule: when the dashboard's own frame asks, it must get the
  # panel alone, or the frame would swallow a second copy of the dashboard.
  test "a frame request for a target renders only the drawer" do
    get project_target_url(@project, @target), headers: { "Turbo-Frame" => "drawer" }

    assert_response :success
    assert_select "turbo-frame#drawer [data-controller=drawer]", 1
    assert_select "##{ActionView::RecordIdentifier.dom_id(@target)}", false,
                  "the frame response should not carry the dashboard rows"
  end

  # Both of these redirect to the dashboard. Followed inside the frame, that redirect is
  # absorbed by the dashboard's own empty drawer frame -- the drawer closes, the flash is
  # dropped, and the row behind it keeps the old name (or the removed output) until the
  # page is reloaded.
  test "the drawer's rename and remove break out of the frame" do
    get project_target_url(@project, @target), headers: { "Turbo-Frame" => "drawer" }

    assert_select "form[action=?][data-turbo-frame=_top]",
                  project_target_path(@project, @target)
    assert_select "form[action=?][data-turbo-frame=_top] input[value=delete]",
                  project_target_path(@project, @target)
  end

  # The dashboard is reachable without a target, so the inline drawer has to stay out of
  # the way when there is none.
  test "the dashboard leaves its drawer frame empty" do
    get project_url(@project)

    assert_select "turbo-frame#drawer"
    assert_select "turbo-frame#drawer [data-controller=drawer]", false
  end

  # There is no browser in this environment, so the drawer's behaviour is only exercised
  # by CI's system tests. These assert the wiring those tests depend on, so a rename of
  # the Stimulus controller or the frame fails here rather than silently in a browser.
  test "the drawer is wired to the drawer controller and the dashboard frame" do
    get project_target_url(@project, @target)
    assert_select "[data-controller=drawer]", minimum: 1
    # The backdrop and the ✕ both close it.
    assert_select "[data-action='click->drawer#close']", minimum: 1
    assert_select "[data-action='drawer#close']", minimum: 1

    get project_url(@project)
    # The row's ⋯ loads into the dashboard's drawer frame rather than navigating.
    assert_select "a[data-turbo-frame=drawer]", minimum: 1
  end

  # Publishing from the drawer used to leave the drawer showing "Publish this output",
  # because the response only replaced the dashboard row behind it.
  test "publishing from the drawer redraws the drawer with the public URL" do
    sign_in users(:two)
    target = targets(:two_web)

    patch publish_project_target_url(projects(:two), target),
          params: { published: true },
          headers: { "Turbo-Frame" => "drawer" },
          as: :turbo_stream

    assert_response :success
    assert_match(/turbo-stream[^>]*target="drawer"/, response.body)
    # The copyable URL points at the published origin, not the origin the drawer is on.
    assert_match(/#{Regexp.escape(published_url(projects(:two), target.slug, host: "pub.example.com"))}/, response.body)
    assert_match(/data-controller="clipboard"/, response.body)
  end

  # The dashboard carries an empty "drawer" frame of its own, so an unguarded replace
  # would pop the drawer open on anyone who published from a row.
  test "publishing from a row does not open the drawer" do
    sign_in users(:two)

    patch publish_project_target_url(projects(:two), targets(:two_web)),
          params: { published: true },
          as: :turbo_stream

    assert_response :success
    assert_no_match(/target="drawer"/, response.body)
  end

  test "the drawer distinguishes what readers see from the last attempt" do
    sign_in users(:two)
    # two_web serves build `two` while a later build failed.
    get project_target_url(projects(:two), targets(:two_web))

    assert_response :success
    assert_match(/Live now/, response.body)
    assert_match(/Last try/, response.body)
  end

  # The header offers one action, whichever way round it is: a build that is running can
  # be stopped, and one that is not can be started.
  test "a running build is offered a cancel button instead of rebuild" do
    # one_web has builds in flight; one_print does not.
    get project_target_url(@project, @target)

    assert_response :success
    assert_equal :building, @target.reload.state
    assert_match cancel_project_build_path(@project, @target.latest_build), response.body
    assert_match(/Cancel build/, response.body)

    get project_target_url(@project, targets(:one_print))

    assert_match(/Rebuild/, response.body)
    assert_no_match(/Cancel build/, response.body)
  end

  test "should create a target" do
    assert_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "Instructor site", kind: "website" } }
    end
    assert_redirected_to project_url(@project)
  end

  test "can add a non-html output" do
    assert_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "Handout", kind: "pdf" } }
    end

    target = @project.targets.find_by(name: "Handout")
    assert_equal "pdf", target.kind
    assert_not target.site?
    assert_equal "handout.pdf", target.output_filename
  end

  # The form asks for one name, not two: what goes into project.ptx and the public URL is
  # derived from what the author typed.
  test "adding an output derives its project.ptx name from the name given" do
    post project_targets_url(@project), params: { target: { name: "Instructor PDF", kind: "pdf" } }

    assert_equal "instructor-pdf", @project.targets.find_by(name: "Instructor PDF").slug
  end

  test "neither form offers to set the slug" do
    get project_url(@project)
    assert_select "input[name='target[slug]']", false, "the add-output form should not ask for a slug"

    get project_target_url(@project, @target)
    assert_select "input[name='target[slug]']", false, "the drawer should not ask for a slug"
  end

  # A target is something an author can ask the build server to run, so the count is
  # bounded even though building itself is open to every owner.
  test "outputs are capped by the user's target quota" do
    quota = @user.target_quota
    (quota - @project.targets.count).times { |i| @project.targets.create!(name: "Extra #{i}", kind: "website") }
    assert_equal quota, @project.targets.count

    assert_no_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "One too many", kind: "website" } }
    end
    assert_redirected_to projects_path
  end

  test "the add-output form disappears at the quota" do
    (@user.target_quota - @project.targets.count).times { |i| @project.targets.create!(name: "Extra #{i}", kind: "website") }

    get project_url(@project)

    assert_response :success
    assert_match(/reached the limit/, response.body)
  end

  test "creating a target with a duplicate name is rejected" do
    assert_no_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "Website", kind: "website" } }
    end
    assert_equal "Name has already been taken", flash[:alert]
  end

  test "should rename a target without moving its public URL" do
    patch project_target_url(@project, @target), params: { target: { name: "Public site" } }

    assert_redirected_to project_url(@project)
    assert_equal "Public site", @target.reload.name
    assert_equal "website", @target.slug
  end

  test "should destroy a target and its builds" do
    build_ids = @target.builds.pluck(:id)

    assert_difference("Target.count", -1) do
      delete project_target_url(@project, @target)
    end

    assert_redirected_to project_url(@project)
    assert_empty Build.where(id: build_ids)
  end

  # ---- publishing ----

  test "publishing exposes the output without starting a build" do
    target = targets(:two_web)
    sign_in users(:two)

    assert_no_difference("Build.count") do
      patch publish_project_target_url(projects(:two), target), params: { published: true }
    end

    assert target.reload.published?
  end

  test "unpublishing is one click back" do
    target = targets(:two_web)
    target.update!(published: true)
    sign_in users(:two)

    patch publish_project_target_url(projects(:two), target), params: { published: false }

    assert_not target.reload.published?
  end

  test "a target with nothing built cannot be published" do
    assert_nil @target.current_build_id

    patch publish_project_target_url(@project, @target), params: { published: true }

    assert_not @target.reload.published?
    assert_match(/Build .* before publishing/, flash[:alert])
  end

  test "publishing swaps the row in place for a turbo request" do
    target = targets(:two_web)
    sign_in users(:two)

    patch publish_project_target_url(projects(:two), target), params: { published: true },
          headers: { "Accept" => "text/vnd.turbo-stream.html" }

    assert_response :success
    assert_match ActionView::RecordIdentifier.dom_id(target), response.body
  end

  test "cannot publish another user's target" do
    patch publish_project_target_url(projects(:two), targets(:two_web)), params: { published: true }

    assert_redirected_to projects_path
    assert_not targets(:two_web).reload.published?
  end

  test "cannot reach another user's target" do
    get project_target_url(projects(:two), targets(:two_web))

    # ApplicationController rescues CanCan::AccessDenied into a redirect.
    assert_redirected_to projects_path
    assert flash[:alert].present?
  end

  # ---- restoring the previous build ----

  test "reverting deletes the newest success and readers get the previous one" do
    target = targets(:one_print)
    older = target.builds.create!(created_at: 2.days.ago, status: :success)
    newer = target.builds.create!(created_at: 1.day.ago, status: :success)
    target.sync_from_builds!
    assert_equal newer, target.reload.current_build

    patch revert_project_target_url(@project, target)

    assert_redirected_to project_target_url(@project, target)
    assert_empty Build.where(id: newer.id)
    assert_equal older, target.reload.current_build
  end

  test "reverting with nothing to fall back to is refused" do
    target = targets(:one_print)
    only = target.builds.create!(status: :success)
    target.sync_from_builds!

    patch revert_project_target_url(@project, target)

    # Refused outright: destroying the only success would take the output down, which
    # is not what "restore" means.
    assert Build.exists?(only.id)
    assert_match(/no earlier build/, flash[:alert])
  end

  test "cannot revert another user's target" do
    patch revert_project_target_url(projects(:two), targets(:two_web))

    assert_redirected_to projects_path
    assert flash[:alert].present?
  end

  test "the drawer offers restore exactly when there is a build to fall back to" do
    target = targets(:one_print)
    target.builds.create!(created_at: 2.days.ago, status: :success)
    target.sync_from_builds!

    get project_target_url(@project, target)
    assert_select "form[action=?]", revert_project_target_path(@project, target), false,
                  "one success has nothing to fall back to"

    target.builds.create!(created_at: 1.day.ago, status: :success)
    target.sync_from_builds!

    get project_target_url(@project, target)
    assert_select "form[action=?][data-turbo-frame=_top]",
                  revert_project_target_path(@project, target)
  end

  # The denormalized current_build_id on targets exists so this page does not issue a
  # query per target. Without the eager load in ProjectsController#index it does.
  test "the projects index does not scale queries with the number of targets" do
    get projects_url # warm any first-request caching so the baseline is honest
    baseline = count_queries { get projects_url }

    projects(:one).targets.create!(name: "Extra one", kind: "pdf")
    projects(:one).targets.create!(name: "Extra two", kind: "epub")

    assert_equal baseline, count_queries { get projects_url },
                 "adding targets changed the query count -- the index has gone N+1"
  end

  private

    def count_queries(&block)
      count = 0
      counter = lambda do |_name, _start, _finish, _id, payload|
        count += 1 unless payload[:name].in?(%w[ SCHEMA TRANSACTION ])
      end
      ActiveSupport::Notifications.subscribed(counter, "sql.active_record", &block)
      count
    end
end
