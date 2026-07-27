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
    project = user.projects.first
    assert project.collaborative?, "fixture project should have a collaborator"

    visit new_user_session_path
    fill_in "user_email", with: user.email
    fill_in "user_password", with: "password123"
    click_button "Sign in"

    visit edit_project_path(project)
    assert_selector ".monaco-editor", wait: 30

    second_window = open_new_window
    within_window(second_window) do
      visit edit_project_path(project)
      assert_selector ".monaco-editor", wait: 30
      # The first window's client should be visible as a presence avatar.
      assert_selector ".pretext-plus-editor__presence-avatar", wait: 15
    end

    # ...and vice versa.
    assert_selector ".pretext-plus-editor__presence-avatar", wait: 15

    # Type a distinctive token into the first window's editor.
    find(".monaco-editor .view-lines").click
    page.send_keys "ZZCOLLABZZ"
    assert_selector ".monaco-editor", text: "ZZCOLLABZZ", wait: 10

    # It must converge into the second window's editor.
    within_window(second_window) do
      assert_selector ".monaco-editor", text: "ZZCOLLABZZ", wait: 15
    end
  end
end
