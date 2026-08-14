require "application_system_test_case"

class PreviewFrameAssetTest < ApplicationSystemTestCase
  setup do
    @user = users(:one)
    @project = projects(:one)
    @asset = assets(:image_one) # ref: "diagram", file pre-attached via fixtures
    sign_in_through_form
  end

  test "an image asset referenced by a relative external/:ref link loads inside the live-preview iframe" do
    visit edit_project_path(@project)
    assert_selector "iframe[name='livePreview']", wait: 20

    # Mirrors the real WASM renderer's output shape for `<image source="..."/>`
    # (see node_modules/@pretextbook/pretext-html/assets/xsl/pretext-html.xsl,
    # image-inclusion mode): a path relative to the frame document's own URL.
    # It has to resolve against /projects/:id/preview-frame.html -- the whole
    # point of ProjectsController#preview_frame -- rather than against the
    # app root, to reach AssetsController#share.
    preview_html = <<~HTML
      <!doctype html><html><body><img src="external/#{@asset.ref}.png" alt="preview frame diagram"></body></html>
    HTML

    loaded_width = eventually(timeout: 15.seconds) do
      write_into_preview_frame(preview_html)
      within_frame("livePreview") do
        next nil unless has_selector?("img[src$='external/#{@asset.ref}.png']", wait: 1)
        width = page.evaluate_script(
          "document.querySelector(\"img[src$='external/#{@asset.ref}.png']\").naturalWidth"
        )
        width if width.to_i > 0
      end
    end

    assert loaded_width, "expected the image asset to finish loading inside the preview iframe"
    assert_equal 4, loaded_width # test_image.png is a 4x4 fixture
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

    # Posts through the same `pretext-plus:frame-write` protocol the real
    # renderer uses (see public/preview-frame.html) -- retried by `eventually`
    # since the shim's message listener isn't registered until the iframe's
    # own navigation to preview-frame.html has completed, which races the
    # editor's mount.
    def write_into_preview_frame(html)
      page.execute_script(<<~JS, html)
        var iframe = document.querySelector("iframe[name='livePreview']");
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: "pretext-plus:frame-write", html: arguments[0], token: "system-test" },
            "*"
          );
        }
      JS
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
