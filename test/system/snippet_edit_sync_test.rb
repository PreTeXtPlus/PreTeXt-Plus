require "application_system_test_case"

# A snippet opens in the code editor like a division: its source is typed there
# and its id is renamed from the settings drawer under the editor's title bar.
# The fixture project is collaborative, so typed source reaches the row through
# the shared document and ProjectDocProjection -- the path division content
# takes -- while a rename is written straight through, host first.
class SnippetEditSyncTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @project = projects(:one)
    @snippet = @project.snippets.create!(ref: "greeting", source: "", source_format: :pretext)

    visit new_user_session_path
    fill_in "user_email", with: @user.email
    fill_in "user_password", with: "password123"
    click_button "Sign in"
    assert_text "Signed in successfully.", wait: 10
  end

  test "typing into an open snippet persists its source" do
    open_snippet

    first(".monaco-editor .view-line", wait: 10).click
    page.send_keys "ZZSNIPPETZZ"
    assert_selector ".monaco-editor", text: "ZZSNIPPETZZ", wait: 10

    source = eventually do
      ProjectDocProjection.new(@project).apply!
      current = @snippet.reload.source
      current if current == "ZZSNIPPETZZ"
    end
    assert_equal "ZZSNIPPETZZ", source || @snippet.reload.source
  end

  test "renaming a snippet from the drawer persists its id" do
    open_snippet
    find("[data-testid='settings-drawer-toggle']").click
    fill_in "snippet-settings-ref", with: "salutation"
    find_field("snippet-settings-ref").send_keys(:enter)

    ref = eventually do
      current = @snippet.reload.ref
      current if current == "salutation"
    end
    assert_equal "salutation", ref || @snippet.reload.ref
    assert_selector "[data-testid='editor-target-title']", text: "salutation"
  end

  private
    def open_snippet
      visit edit_project_path(@project)
      assert_selector ".monaco-editor", wait: 30
      open_explorer_view(:snippets)
      find("[data-testid='snippet-row-#{@snippet.ref}'] button", wait: 20).click
      assert_selector "[data-testid='editor-target-title']", text: @snippet.ref, wait: 10
    end

    def eventually(timeout: 10.seconds)
      deadline = Time.current + timeout
      loop do
        result = yield
        return result if result
        return nil if Time.current > deadline

        sleep 0.25
      end
    end
end
