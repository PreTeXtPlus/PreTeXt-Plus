require "application_system_test_case"

# A tab whose editor writes another layout of the shared document than the
# server holds (a deploy changed it while the tab was open) is refused by the
# server. It must say so and ask for a reload, rather than sit on "Connecting…"
# or quietly stop saving. Simulated by having the server refuse every layout.
class CollabOutdatedTest < ApplicationSystemTestCase
  test "an out-of-date tab asks for a reload, and reloading works once current" do
    project = projects(:one)
    assert project.collaborative?, "fixture project should have a collaborator"
    sign_in_through_form(users(:one))

    ProjectDoc.stub(:compatible?, false) do
      visit edit_project_path(project)
      within("[data-testid='collab-outdated']", wait: 30) do
        assert_text "Please reload the page"
        assert_button "Reload"
      end
      assert_no_selector ".monaco-editor"
    end

    # The server holds this tab's layout again: Reload brings the editor back.
    click_button "Reload"
    assert_selector ".monaco-editor", wait: 30
    assert_no_selector "[data-testid='collab-outdated']"
  end

  private
    def sign_in_through_form(user)
      visit new_user_session_path
      fill_in "user_email", with: user.email
      fill_in "user_password", with: "password123"
      click_button "Sign in"
      assert_text "Signed in successfully.", wait: 10
    end
end
