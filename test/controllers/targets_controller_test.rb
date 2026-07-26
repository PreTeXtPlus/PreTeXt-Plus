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
    assert_match(/#{Regexp.escape(published_url(projects(:two), target.name))}/, response.body)
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

  test "should create a target" do
    assert_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "slides", label: "Slides", kind: "website" } }
    end
    assert_redirected_to project_url(@project)
  end

  test "can add a non-html output" do
    assert_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "handout", label: "Handout PDF", kind: "pdf" } }
    end

    target = @project.targets.find_by(name: "handout")
    assert_equal "pdf", target.kind
    assert_not target.site?
    assert_equal "handout.pdf", target.output_filename
  end

  # A target is something an author can ask the build server to run, so the count is
  # bounded even though building itself is open to every owner.
  test "outputs are capped by the user's target quota" do
    quota = @user.target_quota
    (quota - @project.targets.count).times { |i| @project.targets.create!(name: "extra#{i}", kind: "website") }
    assert_equal quota, @project.targets.count

    assert_no_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "one-too-many", kind: "website" } }
    end
    assert_redirected_to projects_path
  end

  test "the add-output form disappears at the quota" do
    (@user.target_quota - @project.targets.count).times { |i| @project.targets.create!(name: "extra#{i}", kind: "website") }

    get project_url(@project)

    assert_response :success
    assert_match(/reached the limit/, response.body)
  end

  test "creating a target with a duplicate name is rejected" do
    assert_no_difference("Target.count") do
      post project_targets_url(@project), params: { target: { name: "web", kind: "website" } }
    end
    assert_equal "Name has already been taken", flash[:alert]
  end

  test "should rename a target" do
    patch project_target_url(@project, @target), params: { target: { label: "Public site" } }

    assert_redirected_to project_url(@project)
    assert_equal "Public site", @target.reload.label
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

  # The denormalized current_build_id on targets exists so this page does not issue a
  # query per target. Without the eager load in ProjectsController#index it does.
  test "the projects index does not scale queries with the number of targets" do
    get projects_url # warm any first-request caching so the baseline is honest
    baseline = count_queries { get projects_url }

    projects(:one).targets.create!(name: "extra-one", kind: "pdf")
    projects(:one).targets.create!(name: "extra-two", kind: "epub")

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
