require "application_system_test_case"

# An asset's settings are not just editor-local UI state: its `ref` is the name
# `<plus:image ref="..."/>` placeholders resolve against *and* the segment
# `/projects/:id/external/:ref` serves the file from, so a rename that never
# reaches the database leaves every build and published page looking the asset
# up under a name nothing answers to. These drive the real editor because that
# is where the sync used to break -- the server has always accepted
# `assets_attributes`; the client simply wasn't sending the changed fields.
#
# Clicking an asset opens its source in the code editor; its title, id and alt
# text live in the settings drawer under the editor's title bar. The fixture
# project is collaborative, so typed source reaches the row the way division
# content does -- through the shared document and ProjectDocProjection -- while
# drawer edits are written straight through, host first.
class AssetEditSyncTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @project = projects(:one)
    @asset = assets(:image_one)
    sign_in_through_form
  end

  test "editing an asset's title and id persists them to the database" do
    open_asset_settings_for(@asset)

    commit_field "asset-settings-title", "Euler Portrait"
    assert_asset_eventually(title: "Euler Portrait")
    commit_field "asset-settings-ref", "euler-portrait"

    assert_asset_eventually(ref: "euler-portrait", title: "Euler Portrait")
    # The asset stays open under its new name.
    assert_selector "[data-testid='editor-target-bar']", text: "euler-portrait"
  end

  test "editing an asset's content persists its source" do
    open_asset_for(@asset)

    type_into_editor "ZZASSETSOURCEZZ"

    assert_asset_eventually(project: true, source: "ZZASSETSOURCEZZ")
  end

  test "editing an asset's short description persists it" do
    open_asset_settings_for(@asset)

    commit_field "asset-settings-short-description", "A portrait of Euler"

    assert_asset_eventually(short_description: "A portrait of Euler")
  end

  test "replacing an asset's file hands the replacement the old asset's id" do
    open_asset_settings_for(@asset)
    click_button "Replace image…"

    assert_selector "[aria-label='Asset manager']", wait: 10
    attach_file(Rails.root.join("test/fixtures/files/test_image.png"), make_visible: true) do
      find("[aria-label='Paste an image, drag and drop to upload, or click to browse files']").click
    end
    click_button "Add to Project"

    assert_no_selector "[aria-label='Asset manager']", wait: 10

    # The replacement inherits the ref (and title) so every embed already in the
    # document keeps resolving; the row it replaced is gone. Getting there takes
    # two requests -- the old row has to be destroyed before its ref is free --
    # so the whole end state is what's polled for.
    replacement = eventually do
      candidate = @project.assets.reload.find_by(ref: @asset.ref)
      candidate if candidate && candidate.id != @asset.id && candidate.file.attached?
    end
    assert replacement, "expected a new file-backed asset to have taken over ref #{@asset.ref}"
    assert_equal @asset.title, replacement.title
    assert_not Asset.exists?(@asset.id), "the replaced asset's row should be gone"
  end

  test "authoring a new asset creates it without a file, and editing its source persists it" do
    # The ref is server-derived from the title (slugifyRef), not typed in.
    ref = "authored-diagram"

    visit edit_project_path(@project)
    open_explorer_view(:assets)
    assert_selector "button[data-testid='toc-assets-btn']", text: "Add", wait: 20
    find("button[data-testid='toc-assets-btn']", text: "Add").click

    assert_selector "[aria-label='Asset manager']", wait: 10
    click_button "Custom"

    fill_in "am-author-title", with: "Authored Diagram"
    click_button "Create"

    # A bare authored asset (no source yet) is created, then opened in the
    # code editor automatically -- same hand-off as upload/URL.
    assert_no_selector "[aria-label='Asset manager']", wait: 10
    assert_selector "[data-testid='editor-target-title']", text: "Authored Diagram", wait: 10

    asset = eventually { @project.assets.reload.find_by(ref: ref) }
    assert asset, "expected an authored asset to have been created with ref #{ref}"
    assert_equal "authored", asset.kind
    assert_not asset.file.attached?

    # An authored asset's source is its entire content, typed straight into
    # the code editor.
    type_into_editor "ZZAUTHOREDZZ"

    source = eventually do
      ProjectDocProjection.new(@project).apply!
      current = asset.reload.source
      current if current == "ZZAUTHOREDZZ"
    end
    assert_equal "ZZAUTHOREDZZ", source || asset.reload.source
  end

  private
    def sign_in_through_form
      visit new_user_session_path
      fill_in "user_email", with: @user.email
      fill_in "user_password", with: "password123"
      click_button "Sign in"
      # Wait for the post-login navigation to land: `visit` doesn't queue behind
      # an in-flight one, so without this the editor page can be replaced by the
      # redirect that was already on its way.
      assert_text "Signed in successfully.", wait: 10
    end

    # Open the asset in the code editor from the explorer's Assets view.
    def open_asset_for(asset)
      visit edit_project_path(@project)
      assert_selector ".monaco-editor", wait: 30
      open_explorer_view(:assets)
      find("[data-testid='asset-row-#{asset.ref}'] button", wait: 20).click
      assert_selector "[data-testid='editor-target-title']", text: asset.title, wait: 10
    end

    # ...and drop down its settings drawer.
    def open_asset_settings_for(asset)
      open_asset_for(asset)
      find("[data-testid='settings-drawer-toggle']").click
      assert_selector "[data-testid='settings-drawer']", wait: 10
    end

    # Drawer fields commit on Enter (or blur), once per edit.
    def commit_field(id, value)
      fill_in id, with: value
      find_field(id).send_keys(:enter)
    end

    # Monaco only accepts keystrokes once its hidden textarea has focus, and it
    # only takes focus from a click on a concrete `.view-line`, never the
    # `.view-lines` container. An asset's buffer has no locked lines, so any
    # line will do.
    def type_into_editor(text)
      first(".monaco-editor .view-line", wait: 10).click
      page.send_keys text
      assert_selector ".monaco-editor", text: text, wait: 10
    end

    # Drawer edits are a PATCH fired after the field commits, so the row lands a
    # beat later than the UI; typed source reaches the row through the shared
    # document, so `project:` runs the projection the server runs on a timer.
    # Poll rather than sleep.
    def assert_asset_eventually(project: false, **expected)
      actual = eventually do
        ProjectDocProjection.new(@project).apply! if project
        @asset.reload
        current = expected.keys.index_with { |field| @asset.public_send(field) }
        current if current == expected
      end
      assert_equal expected, actual || expected.keys.index_with { |f| @asset.public_send(f) }
    end

    # Poll `block` until it returns something truthy, or give up and return nil
    # so the caller can assert against the real (wrong) end state.
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
