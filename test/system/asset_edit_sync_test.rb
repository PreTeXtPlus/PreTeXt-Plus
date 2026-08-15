require "application_system_test_case"

# The asset editor's fields are not just editor-local UI state: an asset's `ref`
# is the name `<plus:image ref="..."/>` placeholders resolve against *and* the
# segment `/projects/:id/external/:ref` serves the file from, so a rename that
# never reaches the database leaves every build and published page looking the
# asset up under a name nothing answers to. These drive the real editor because
# that is where the sync used to break -- the server has always accepted
# `assets_attributes`; the client simply wasn't sending the changed fields.
class AssetEditSyncTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @project = projects(:one)
    @asset = assets(:image_one)
    sign_in_through_form
  end

  test "editing an asset's title and id persists them to the database" do
    open_asset_editor_for(@asset.ref)

    fill_in "am-edit-title", with: "Euler Portrait"
    fill_in "am-edit-ref", with: "euler-portrait"
    within("[aria-label^='Manage asset']") { click_button "Save" }

    assert_no_selector "[aria-label^='Manage asset']", wait: 10

    assert_asset_eventually(ref: "euler-portrait", title: "Euler Portrait")
  end

  test "editing an asset's content persists its source" do
    open_asset_editor_for(@asset.ref)

    # The content editor is Monaco, which only accepts keystrokes once its
    # hidden textarea has focus -- and it only takes focus from a click on a
    # concrete `.view-line`, never the `.view-lines` container.
    find("details[data-testid='asset-edit-advanced']").click
    within("[data-testid='asset-edit-source-editor']") do
      assert_selector ".view-line", wait: 10
      first(".view-line").click
    end
    page.send_keys "<description>A portrait</description>"
    within("[aria-label^='Manage asset']") { click_button "Save" }

    assert_no_selector "[aria-label^='Manage asset']", wait: 10

    assert_asset_eventually(source: "<description>A portrait</description>")
  end

  test "editing an asset's short description persists it" do
    open_asset_editor_for(@asset.ref)

    fill_in "am-edit-short-description", with: "A portrait of Euler"
    within("[aria-label^='Manage asset']") { click_button "Save" }

    assert_no_selector "[aria-label^='Manage asset']", wait: 10

    assert_asset_eventually(short_description: "A portrait of Euler")
  end

  test "replacing an asset's file hands the replacement the old asset's id" do
    open_asset_editor_for(@asset.ref)
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

    # Open the standalone asset editor on the asset with this ref, by way of the
    # asset manager -- the only route a user has to it.
    def open_asset_editor_for(ref)
      visit edit_project_path(@project)
      assert_selector "button[data-testid='toc-assets-btn']", text: "Manage", wait: 20
      find("button[data-testid='toc-assets-btn']", text: "Manage").click

      assert_selector "[aria-label='Asset manager']", wait: 10
      find("[data-testid='am-doc-row']", text: ref, wait: 10)
        .find("button[data-testid='am-row-info-btn']").click

      assert_selector "[aria-label^='Manage asset']", wait: 10
    end

    # The save is a PATCH the browser fires after the modal closes, so the row
    # lands a beat later than the assertion above; poll rather than sleep.
    def assert_asset_eventually(expected)
      actual = eventually do
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
