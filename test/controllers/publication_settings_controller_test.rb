require "test_helper"

class PublicationSettingsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    @project = projects(:one)
    @target = targets(:one_web)
    sign_in @user
  end

  # The modal only ever answers the frame that asks for it, so every GET here says so.
  def modal_headers
    { "Turbo-Frame" => "modal" }
  end

  test "the account modal offers the catalog and saves a choice" do
    get edit_user_publication_settings_url(@user), headers: modal_headers

    assert_response :success
    assert_select "turbo-frame#modal [data-controller=modal]"
    assert_select "select[name='publication_settings[theme]']"

    patch user_publication_settings_url(@user), params: { publication_settings: { theme: "salem" } }

    assert_redirected_to edit_user_path(@user)
    assert_equal "salem", @user.reload.publication_settings["theme"]
  end

  # Rails' select helper takes [label, value], the reverse of how the catalog reads. Get
  # the flip wrong and every option submits its own label ("Salem"), which validation then
  # refuses -- so the form looks right and nothing can be saved.
  test "options carry catalog values, not their labels" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "select[name='publication_settings[theme]'] option[value=salem]", text: "Salem"
  end

  # The select shows what this level chose, not what it inherited: an inherited value
  # rendered as selected would become an override the first time anything was saved.
  test "the select preselects this level's own choice and leaves an inherited one blank" do
    @user.update!(publication_settings: { "theme" => "salem" })
    @project.update!(publication_settings: { "chunk_level" => "2" })

    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "select[name='publication_settings[chunk_level]'] option[selected][value='2']"
    assert_select "select[name='publication_settings[theme]'] option[selected]", false
    assert_select "select[name='publication_settings[theme]'] option[value='']",
      text: /Inherit — Salem \(from your account\)/
  end

  # An output is offered tabs for General and its own format, and never one for a format
  # it is not: a PDF has no theme, and saying otherwise is how an author comes to believe
  # they set one.
  test "an output's modal drops the tabs its format does not reach" do
    get edit_project_target_publication_settings_url(@project, targets(:one_print)),
      headers: modal_headers

    assert_select "[role=tab]", 2
    assert_select "#publication-tab-pdf"
    assert_select "#publication-tab-html", false
    assert_select "select[name='publication_settings[theme]']", false
    assert_select "select[name='publication_settings[latex_sides]']"
  end

  test "a project's modal offers every format's tab" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    %w[ general html pdf braille ].each { |family| assert_select "#publication-tab-#{family}" }
  end

  # A braille page size is a number to type, not a list to pick from, and empty still
  # means inherit -- so the placeholder has to carry what the select's blank option does.
  test "a braille page size renders as a bounded number field" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "input[type=number][name='publication_settings[braille_page_width]']" \
                  "[min='1'][max='100']" do |input|
      assert_match(/Inherit — PreTeXt's default \(40 cells\)/, input.first["placeholder"])
    end
  end

  test "a braille page size saves, and a nonsense one is refused" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { braille_page_width: "32" } }
    assert_equal "32", @project.reload.publication_settings["braille_page_width"]

    patch project_publication_settings_url(@project),
      params: { publication_settings: { braille_page_width: "-4" } }
    assert_match(/cells per line/, flash[:alert])
    assert_equal "32", @project.reload.publication_settings["braille_page_width"]
  end

  # The EPUB tab appears once the project has an image to be a cover, and the picker
  # offers it under the name the archive writes it as.
  test "the cover picker offers the project's own images" do
    assets(:image_one).file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png", content_type: "image/png"
    )

    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "#publication-tab-epub"
    assert_select "select[name='publication_settings[epub_cover]'] " \
                  "option[value=?]", "#{assets(:image_one).ref}.png"
  end

  # Without one, the tab stays but says what to do -- an author who has never built an
  # EPUB should still find out a cover is something they can set.
  test "with no images the cover says what to do instead of offering an empty picker" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "#publication-tab-epub"
    assert_select "select[name='publication_settings[epub_cover]']", false
    assert_select "#publication-panel-epub", /upload an image/i
  end

  # Panels are hidden, not unmounted, so a change on one tab and a change on another save
  # together. Anything else silently drops half of what an author just did.
  test "fields on every tab submit together" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { theme: "salem", latex_sides: "two", toc_level: "1" } }

    assert_equal({ "theme" => "salem", "latex_sides" => "two", "toc_level" => "1" },
                 @project.reload.publication_settings)
  end

  # One tab is not a choice. The panel and its note still render; only the strip goes.
  # A PDF of a slideshow is the case: slides number no divisions and list no contents, so
  # General empties out and only the PDF options are left.
  test "a level reaching one family gets no tab strip" do
    handout = projects(:slides).targets.create!(name: "Handout", kind: "pdf")

    get edit_project_target_publication_settings_url(projects(:slides), handout),
      headers: modal_headers

    assert_select "[role=tablist]", false
    assert_select "[role=tabpanel]", 1
    assert_select "select[name='publication_settings[latex_sides]']"
  end

  # Whatever id the path carries, an author edits their own account -- the same rule
  # users#edit follows.
  test "the account modal edits the signed-in user, not the one named in the path" do
    patch user_publication_settings_url(users(:two)), params: { publication_settings: { theme: "denver" } }

    assert_equal "denver", @user.reload.publication_settings["theme"]
    assert_empty users(:two).reload.publication_settings
  end

  test "a project's settings save and send the author back to the dashboard" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { chunk_level: "1" } }

    assert_redirected_to project_path(@project)
    assert_equal "1", @project.reload.publication_settings["chunk_level"]
  end

  # An output's modal opens over the drawer, so saving has to put the drawer back rather
  # than leave the author on a bare dashboard wondering where they were.
  test "an output's settings save and reopen its drawer" do
    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { theme: "denver" } }

    assert_redirected_to project_target_path(@project, @target)
    assert_equal "denver", @target.reload.publication_settings["theme"]
  end

  # Submitting the empty choice is how an override is cleared; it must not store a blank
  # that would then shadow the level above.
  test "submitting the empty choice clears an override" do
    @target.update!(publication_settings: { "theme" => "denver" })

    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { theme: "" } }

    assert_empty @target.reload.publication_settings
  end

  # The modal shows only what the level offers, so a submission carries only those keys.
  # Replacing the hash rather than merging it would drop a setting that a document-type
  # change has since hidden -- silently, and only for whoever saved something unrelated.
  test "saving one option leaves an option the modal did not offer alone" do
    @target.update!(publication_settings: { "theme" => "denver", "chunk_level" => "1" })

    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { theme: "salem" } }

    assert_equal({ "theme" => "salem", "chunk_level" => "1" }, @target.reload.publication_settings)
  end

  test "a value outside the catalog is refused" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { theme: "not-a-theme" } }

    assert_redirected_to project_path(@project)
    assert_empty @project.reload.publication_settings
    assert_match(/theme/, flash[:alert])
  end

  test "a key outside the catalog is not stored" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { theme: "salem", latex_engine: "xelatex" } }

    assert_equal({ "theme" => "salem" }, @project.reload.publication_settings)
  end

  # A collaborator is a co-author: they get the same access to build settings that they
  # have to everything else about the project.
  test "a collaborator may edit a project's and an output's settings" do
    sign_in users(:two)

    patch project_publication_settings_url(@project), params: { publication_settings: { chunk_level: "1" } }
    assert_redirected_to project_path(@project)

    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { theme: "salem" } }
    assert_redirected_to project_target_path(@project, @target)
  end

  test "someone with no access to the project is refused" do
    sign_in users(:subscribed)

    patch project_publication_settings_url(@project), params: { publication_settings: { chunk_level: "1" } }

    assert_redirected_to projects_path
    assert_empty @project.reload.publication_settings
  end

  # Nothing links to these URLs and Turbo leaves the address bar on the page underneath,
  # so a plain visit is a stray URL. It gets the page the modal would have opened over --
  # not a dialog floating over an empty document, which is the bug the target drawer hit.
  test "a request that is not the frame asking lands on the page underneath" do
    get edit_project_publication_settings_url(@project)

    assert_redirected_to project_path(@project)
  end

  # A slideshow numbers no divisions and pages itself, so its slides output has nothing to
  # offer. An empty dialog would read as a bug.
  test "an output with nothing to choose says so instead of showing an empty form" do
    get edit_project_target_publication_settings_url(projects(:slides), targets(:slides_deck)),
      headers: modal_headers

    assert_response :success
    assert_select "form", false
    assert_select "turbo-frame#modal", /no build settings/i
  end
end
