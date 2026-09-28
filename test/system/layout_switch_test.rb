require "application_system_test_case"

# Crossing the editor's tabbed/split layout breakpoint (800px) remounts the code
# editor, and the code editor holds typing for 500ms before reporting it. Typing
# still held when it unmounts used to be dropped: it vanished from the screen,
# the save status said "Saved", and it never reached the server.
class LayoutSwitchTest < ApplicationSystemTestCase
  teardown { page.current_window.resize_to(1400, 1400) }

  test "typing just before a layout switch survives it and is saved" do
    project = projects(:two)
    visit new_user_session_path
    fill_in "user_email", with: users(:two).email
    fill_in "user_password", with: "password123"
    click_button "Sign in"
    # Wait for the post-login navigation to land: `visit` doesn't queue behind
    # an in-flight one, so without this the editor page can be replaced by the
    # redirect that was already on its way.
    assert_text "Signed in successfully.", wait: 10

    visit edit_project_path(project)
    assert_selector ".monaco-editor", wait: 30

    # Click on the body text itself, never the `.view-lines` container: that
    # container runs past the last line, into the locked closing tag, where
    # typing is discarded (see CollaborativeEditingTest).
    find(".monaco-editor .view-line", text: "Hello world").click
    page.send_keys "ZZRESIZEZZ"
    assert_selector ".monaco-editor", text: "ZZRESIZEZZ", wait: 10
    # Straight away, inside the debounce.
    page.current_window.resize_to(390, 844)

    assert_selector ".monaco-editor", text: "ZZRESIZEZZ", wait: 10
    find("[data-testid='save-status'][data-status='unsaved']", wait: 10).click
    assert_selector "[data-testid='save-status'][data-status='saved']", wait: 10
    assert_includes project.root_division.reload.source, "ZZRESIZEZZ"
  end
end
