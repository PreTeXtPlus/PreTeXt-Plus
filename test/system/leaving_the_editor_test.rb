require "application_system_test_case"

# A solo editor saves on a timer (editor.jsx's AUTOSAVE_MS, 10s), so every way
# out of it has to save first or it drops whatever was typed since the last
# tick; a collaborative one has to wait for the server to acknowledge the last
# keystrokes. These leave well inside that window, so they only pass if the way
# out did the saving.
class LeavingTheEditorTest < ApplicationSystemTestCase
  test "Manage project saves a solo project, then opens its project page" do
    project = projects(:two)
    open_editor(project, as: users(:two))

    type_into_editor("Hello world", "ZZPUBLISHZZ")
    click_button "Manage project"

    assert_current_path project_path(project), wait: 10
    assert_includes project.root_division.reload.source, "ZZPUBLISHZZ"
  end

  test "the logo saves a solo project before leaving for the project list" do
    project = projects(:two)
    open_editor(project, as: users(:two))

    type_into_editor("Hello world", "ZZLOGOZZ")
    find("img[alt='PreTeXtPlus Logo']").click

    assert_current_path projects_path, wait: 10
    assert_includes project.root_division.reload.source, "ZZLOGOZZ"
  end

  test "the save status reports unsaved changes and saves them on a click" do
    project = projects(:two)
    open_editor(project, as: users(:two))
    assert_selector "[data-testid='save-status'][data-status='saved']"

    type_into_editor("Hello world", "ZZSTATUSZZ")
    # The editor reports typing on a 500ms debounce.
    find("[data-testid='save-status'][data-status='unsaved']", wait: 5).click

    assert_selector "[data-testid='save-status'][data-status='saved']", wait: 10
    assert_includes project.root_division.reload.source, "ZZSTATUSZZ"
  end

  # Chrome under WebDriver accepts a beforeunload prompt on its own, so a real
  # reload can't show whether one was asked for. Dispatching the event directly
  # reads the handler's answer: a prevented default is the prompt.
  test "leaving through the browser asks first while an edit is unsaved, and saves it" do
    project = projects(:two)
    open_editor(project, as: users(:two))
    assert_selector "[data-testid='save-status'][data-status='saved']"
    assert_not unload_prompted?, "nothing is unsaved yet"

    type_into_editor("Hello world", "ZZUNLOADZZ")
    # Still inside the editor's 500ms debounce: the host has not heard of it.
    assert unload_prompted?, "an unsaved edit should be guarded"

    assert_selector "[data-testid='save-status'][data-status='saved']", wait: 10
    assert_includes project.root_division.reload.source, "ZZUNLOADZZ"
    assert_not unload_prompted?, "the edit has been saved"
  end

  # A snippet's typed source is unsaved work like a division's: it holds the
  # status at "unsaved", guards the unload, and goes out with the save.
  test "a snippet's typed source counts as unsaved and is saved on leaving" do
    project = projects(:two)
    snippet = project.snippets.create!(ref: "greeting", source: "Hello snippet", source_format: :pretext)
    open_editor(project, as: users(:two))
    open_explorer_view(:snippets)
    find("[data-testid='snippet-row-#{snippet.ref}'] button", wait: 20).click
    assert_selector "[data-testid='editor-target-title']", text: snippet.ref, wait: 10
    assert_selector "[data-testid='save-status'][data-status='saved']"

    type_into_editor("Hello snippet", "ZZSNIPPETSAVEZZ")
    # The editor reports typing on a 500ms debounce.
    assert_selector "[data-testid='save-status'][data-status='unsaved']", wait: 5
    # Asking also starts the save, as the page would on its way out.
    assert unload_prompted?, "an unsaved snippet edit should be guarded"

    assert_selector "[data-testid='save-status'][data-status='saved']", wait: 10
    assert_includes snippet.reload.source, "ZZSNIPPETSAVEZZ"
    assert_not unload_prompted?, "the snippet edit has been saved"
  end

  # A settings edit makes the host re-fetch the project, which hands the editor
  # a fresh snippet pool built from the server's rows. A snippet that isn't
  # open, with typing the next save hasn't sent yet, must come back with that
  # typing (the host lays its working copy's sources over the server's), not
  # with the stale server copy -- and the typing must still be saved.
  test "a refetch keeps a closed snippet's unsaved typing" do
    project = projects(:two)
    alpha = project.snippets.create!(ref: "alpha", source: "Alpha text", source_format: :pretext)
    beta = project.snippets.create!(ref: "beta", source: "Beta text", source_format: :pretext)
    open_editor(project, as: users(:two))
    open_explorer_view(:snippets)

    open_snippet_row(alpha)
    type_into_editor("Alpha text", "ZZREFETCHZZ")
    assert_selector "[data-testid='save-status'][data-status='unsaved']", wait: 5

    # Leave it unsaved and closed, then rename the other snippet: a PATCH,
    # then the re-fetch.
    open_snippet_row(beta)
    requests_before = project_json_requests(project)
    fill_in "snippet-settings-ref", with: "beta-renamed"
    find_field("snippet-settings-ref").send_keys(:enter)
    assert_selector "[data-testid='editor-target-title']", text: "beta-renamed", wait: 10
    assert_equal "beta-renamed", beta.reload.ref
    assert_operator project_json_requests(project), :>=, requests_before + 2,
      "expected the rename's PATCH and the re-fetch it triggers"

    # The premise: the typing hasn't been saved yet, so only the overlay could
    # have kept it through the re-fetch.
    assert_selector "[data-testid='save-status'][data-status='unsaved']"
    assert_not_includes alpha.reload.source, "ZZREFETCHZZ"

    open_snippet_row(alpha)
    assert_selector ".monaco-editor", text: "ZZREFETCHZZ", wait: 10

    find("[data-testid='save-status'][data-status='unsaved']").click
    assert_selector "[data-testid='save-status'][data-status='saved']", wait: 10
    assert_includes alpha.reload.source, "ZZREFETCHZZ"
  end

  test "Manage project flushes a collaborative project's last edits to the project page" do
    project = projects(:one)
    assert project.collaborative?, "fixture project should have a collaborator"
    open_editor(project, as: users(:one))

    type_into_editor("World", "ZZCOLLABPUBLISHZZ")
    click_button "Manage project"

    assert_current_path project_path(project), wait: 15
    assert_includes project.root_division.reload.source, "ZZCOLLABPUBLISHZZ"
  end

  private
    def open_editor(project, as:)
      visit new_user_session_path
      fill_in "user_email", with: as.email
      fill_in "user_password", with: "password123"
      click_button "Sign in"
      # Wait for the post-login navigation to land: `visit` doesn't queue behind
      # an in-flight one, so without this the editor page can be replaced by the
      # redirect that was already on its way.
      assert_text "Signed in successfully.", wait: 10

      visit edit_project_path(project)
      assert_selector ".monaco-editor", wait: 30
    end

    # Click on the body text itself, never the `.view-lines` container: that
    # container runs past the last line, into the locked closing tag, where
    # typing is discarded (see CollaborativeEditingTest).
    def type_into_editor(line_text, token)
      find(".monaco-editor .view-line", text: line_text).click
      page.send_keys token
      assert_selector ".monaco-editor", text: token, wait: 10
    end

    def open_snippet_row(snippet)
      find("[data-testid='snippet-row-#{snippet.ref}'] button", wait: 20).click
      assert_selector "[data-testid='editor-target-title']", text: snippet.ref, wait: 10
    end

    # Requests the page has made to the project's JSON endpoint (the load,
    # each save and settings PATCH, each re-fetch). Resource timing doesn't
    # record a method, so a PATCH and a GET count alike.
    def project_json_requests(project)
      page.evaluate_script(<<~JS)
        performance.getEntriesByType("resource")
          .filter((e) => new URL(e.name).pathname === "#{project_path(project, format: :json)}")
          .length
      JS
    end

    def unload_prompted?
      page.evaluate_script(<<~JS)
        (() => {
          const event = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        })()
      JS
    end
end
