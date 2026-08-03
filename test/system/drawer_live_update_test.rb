require "application_system_test_case"

# The drawer's live update has now been got wrong twice in ways no non-browser test could
# see: once by broadcasting only the dashboard row, and once by broadcasting a payload too
# large for development's Action Cable transport to deliver. Both looked completely fine in
# controller and model tests. This is the test that actually watches the DOM change.
class DrawerLiveUpdateTest < ApplicationSystemTestCase
  include ActiveJob::TestHelper

  setup do
    @user = users(:one)
    @target = targets(:one_web)

    visit new_user_session_path
    fill_in "user_email", with: @user.email
    fill_in "user_password", with: "password123"
    click_button "Sign in"
    # Let the redirect land before any test navigates away from it.
    assert_selector "h1", wait: 10
  end

  test "a drawer opened from a dashboard row picks up a finished build" do
    visit project_path(@target.project)

    row = "##{ActionView::RecordIdentifier.dom_id(@target)}"
    assert_selector row, wait: 10
    within(row) { find("a[aria-label='#{@target.name} details']").click }

    within_drawer do
      assert_text "Building", wait: 10
      assert_button "Cancel build"
    end

    finish_build!(log: "Sage traceback line\n" * 3000)

    within_drawer do
      # The header action flips, which is the state changing.
      assert_button "Rebuild", wait: 10
      assert_no_button "Cancel build"
      # ...and the two things a size-limited broadcast could not have carried: a log far
      # past what Postgres's NOTIFY would accept, and the new history row.
      assert_text "Sage traceback line"
      assert_selector "tbody tr", minimum: 2
    end
  end

  # The other way in: a bookmark or the breadcrumb on a build log, where the dashboard is
  # rendered with the drawer already open and no frame navigation ever set the frame's src.
  test "a drawer reached by a full-page visit picks up a finished build" do
    visit project_target_path(@target.project, @target)

    within_drawer do
      assert_text "Building", wait: 10
    end

    finish_build!(log: "done")

    within_drawer do
      assert_button "Rebuild", wait: 10
      assert_no_button "Cancel build"
      assert_text "done"
    end
  end

  # Why the frame is marked refresh="morph". A plain reload would rebuild the panel, so an
  # author reading a long build log would be thrown back to the top of it every time the
  # next status arrived -- and a build reports several.
  test "a refresh morphs the panel instead of rebuilding it" do
    @target.latest_build.update_columns(log: "log line\n" * 500)
    visit project_target_path(@target.project, @target)

    log_box = "##{ActionView::RecordIdentifier.dom_id(@target, :drawer)} pre"
    assert_selector log_box, wait: 10

    # projects/show.html.erb renders this frame with both content and a src, which Turbo
    # answers with one unconditional, non-morph self-fetch (see the comment there). Setting
    # the scroll position before that settles is a race: if it lands after we grab
    # window.__logBox below, it silently replaces the very node we scrolled with a fresh
    # one at scrollTop 0, and this test would be checking the wrong reload entirely.
    # Waiting for `complete` pins us to *after* that fetch, so what's left to provoke is
    # the one the test is actually about: the broadcast-triggered reload.
    assert_selector "turbo-frame#drawer[complete]", wait: 10
    page.execute_script("document.querySelector('#{log_box}').scrollTop = 200")
    page.execute_script("window.__logBox = document.querySelector('#{log_box}')")

    finish_build!(log: "log line\n" * 500)

    within_drawer { assert_button "Rebuild", wait: 10 }
    assert page.evaluate_script("window.__logBox === document.querySelector('#{log_box}')"),
      "the log box was replaced rather than morphed"
    assert_equal 200, page.evaluate_script("document.querySelector('#{log_box}').scrollTop")
  end

  # The path an author actually takes: open the drawer, press the button *in it*, wait.
  # Rebuilding from the drawer re-renders the frame from the server, and if that response
  # drops the frame's src -- which is what Turbo reloads -- the drawer goes deaf to every
  # later broadcast and sits on "Building" while the row behind it finishes.
  test "a drawer that started the build itself picks up the finish" do
    target = targets(:one_print)
    visit project_path(target.project)

    row = "##{ActionView::RecordIdentifier.dom_id(target)}"
    assert_selector row, wait: 10
    within(row) { find("a[aria-label='#{target.name} details']").click }

    panel = "##{ActionView::RecordIdentifier.dom_id(target, :drawer)}"
    assert_selector panel, wait: 10
    within(panel) { click_button "Rebuild" }
    within(panel) { assert_button "Cancel build", wait: 10 }

    # Finish it the way the callback would. Not inside perform_enqueued_jobs: the queue
    # still holds the FullBuildJob this just enqueued, which would go to the build server.
    target.reload.latest_build.mark!(:success, log: "built cleanly")

    within(panel) do
      assert_button "Rebuild", wait: 10
      assert_no_button "Cancel build"
      assert_text "built cleanly"
    end
  end

  # A build on one output must not disturb an author reading a different one.
  test "a build elsewhere in the project leaves an open drawer alone" do
    visit project_target_path(@target.project, @target)
    assert_selector "##{ActionView::RecordIdentifier.dom_id(@target, :drawer)}", wait: 10

    other = targets(:one_print)
    perform_enqueued_jobs { other.builds.create!(project: other.project).mark!(:success) }

    # The row behind it updates; the drawer still shows the target it was opened on.
    assert_selector "##{ActionView::RecordIdentifier.dom_id(other)}", text: "Rebuild", wait: 10
    within_drawer { assert_text "Building" }
  end

  private

    def within_drawer(&block)
      within("##{ActionView::RecordIdentifier.dom_id(@target, :drawer)}", &block)
    end

    def finish_build!(log:)
      perform_enqueued_jobs { @target.latest_build.mark!(:success, log: log) }
    end
end
