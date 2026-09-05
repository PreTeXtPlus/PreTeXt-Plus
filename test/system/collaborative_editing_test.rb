require "application_system_test_case"

# True end-to-end check of real-time collaboration: two editor clients (two
# windows of one browser -- the test Selenium node only affords a single
# concurrent browser session) open the same collaborative project, one types,
# and the text must appear in the other via the Yjs-over-ActionCable relay.
# Who may join the session is covered by ProjectDocChannel/ProjectDocs
# controller tests; this exercises the live sync loop itself.
class CollaborativeEditingTest < ApplicationSystemTestCase
  test "an edit in one editor client appears live in another" do
    user = users(:one)
    project = projects(:one)
    assert project.collaborative?, "fixture project should have a collaborator"

    visit new_user_session_path
    fill_in "user_email", with: user.email
    fill_in "user_password", with: "password123"
    click_button "Sign in"
    # Wait for the post-login navigation to land: `visit` doesn't queue behind
    # an in-flight one, so without this the editor page can be replaced by the
    # redirect that was already on its way.
    assert_text "Signed in successfully.", wait: 10

    visit edit_project_path(project)
    assert_selector ".monaco-editor", wait: 30

    second_window = open_new_window
    within_window(second_window) do
      visit edit_project_path(project)
      assert_selector ".monaco-editor", wait: 30
      # The first window's client should be visible as a presence avatar.
      assert_selector "[data-testid='presence-avatar']", wait: 15
    end

    # ...and vice versa.
    assert_selector "[data-testid='presence-avatar']", wait: 15

    # Type a distinctive token into the first window's editor. Click on the
    # body text itself (not the generic `.view-lines` container): Monaco's
    # default `scrollBeyondLastLine` leaves that container much taller than
    # the six lines of fixture content, so a center-click there lands past
    # the last line — inside the locked closing tag — and the collab edit
    # guard silently discards anything typed there.
    find(".monaco-editor .view-line", text: "World").click
    page.send_keys "ZZCOLLABZZ"
    assert_selector ".monaco-editor", text: "ZZCOLLABZZ", wait: 10

    # It must converge into the second window's editor.
    within_window(second_window) do
      assert_selector ".monaco-editor", text: "ZZCOLLABZZ", wait: 15
    end
  end
end
