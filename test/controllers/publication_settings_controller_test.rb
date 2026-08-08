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
    assert_match(/Cells per line/, flash[:alert])
    assert_equal "32", @project.reload.publication_settings["braille_page_width"]
  end

  # The modal holds every setting of a level and saves them together, so an all-or-nothing
  # write means one mistyped margin costs an author the changes they made beside it -- and
  # costs them silently, since the modal is gone by the time they read the alert. Each
  # value stands or falls on its own instead.
  test "one value this level cannot accept does not cost the author the rest" do
    @project.update!(publication_settings: { "worksheet_margin" => "1in" })

    patch project_publication_settings_url(@project),
      params: { publication_settings: { worksheet_margin: "1 furlong", theme: "salem",
                                        chunk_level: "2" } }

    assert_equal({ "worksheet_margin" => "1in", "theme" => "salem", "chunk_level" => "2" },
                 @project.reload.publication_settings)
  end

  # And says which setting was left alone, what would not go in it, and what one looks
  # like: the modal is closed by the time this is read, so the sentence is the whole of
  # what an author has to go back in with.
  test "the alert names the refused setting and the shape of a good answer" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { worksheet_top: "1 furlong", theme: "salem" } }

    assert_match(/Saved everything else/, flash[:alert])
    assert_match(/Top margin is unchanged: “1 furlong” is not a length with its unit/,
                 flash[:alert])
    assert_equal({ "theme" => "salem" }, @project.reload.publication_settings)
  end

  # A refused value leaves the setting as it was rather than clearing it: a typo is not an
  # instruction to inherit, and the level above taking over is exactly the surprise an
  # author would not think to look for.
  test "a refused value keeps what the level had rather than clearing it" do
    @target.update!(publication_settings: { "theme" => "denver" })

    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { theme: "not-a-theme" } }

    assert_equal "denver", @target.reload.publication_settings["theme"]
  end

  # A margin is typed, and the two ways it is typed wrong are a missing leading zero and a
  # missing unit. Both are values an author means; writing back what they meant beats an
  # alert that sends them into the modal to add a character.
  test "a margin typed as a bare or bare-headed number is saved as a length" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { worksheet_margin: ".25", worksheet_left: "1",
                                        worksheet_right: "0.5 CM" } }

    assert_equal({ "worksheet_margin" => "0.25in", "worksheet_left" => "1in",
                   "worksheet_right" => "0.5cm" }, @project.reload.publication_settings)
    assert_equal "Saved.", flash[:notice]
  end

  # Components are separated by spaces because that is what PreTeXt splits on, but a list
  # is written with commas everywhere else and an author who types them means the same
  # thing. What gets stored is what the publication file needs.
  test "version components typed as a comma-separated list are saved space-separated" do
    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { version: " instructor,  solutions " } }

    assert_equal "instructor solutions", @target.reload.publication_settings["version"]
    assert_equal "Saved.", flash[:notice]
  end

  # A name carrying a space or a "|" would break PreTeXt's fencing, so the pattern is a
  # boundary rather than a nicety -- and the setting keeps whatever it had.
  test "a version component that would break the fencing is refused" do
    @target.update!(publication_settings: { "version" => "instructor" })

    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { version: "instructor|solutions" } }

    assert_equal "instructor", @target.reload.publication_settings["version"]
    assert_match(/version components/i, flash[:alert])
  end

  # The checkbox beside the field is the third state: empty is not unset, and an empty
  # field already means unset. What gets stored is the marker standing for the box.
  test "checking the empty box with an empty field stores the marker" do
    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { version: "", version_empty: "1" } }

    assert_equal Publication::Catalog::EMPTY_MARKER,
                 @target.reload.publication_settings["version"]
  end

  # Text an author typed is what they meant. A box left checked from a previous visit must
  # not silently discard it -- so the field wins whenever it has anything in it.
  test "a typed list wins over a checked empty box" do
    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { version: "instructor", version_empty: "1" } }

    assert_equal "instructor", @target.reload.publication_settings["version"]
  end

  # And unchecking it is the way back out, to inheriting rather than to an empty version.
  test "clearing the field and the box goes back to inheriting" do
    @target.update!(publication_settings: { "version" => Publication::Catalog::EMPTY_MARKER })

    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { version: "", version_empty: "0" } }

    assert_not_includes @target.reload.publication_settings.keys, "version"
  end

  # The box is a form control, not a setting, so it must not survive as one -- a stored
  # "version_empty" would be a key the catalog cannot place and the writer would drop.
  test "the checkbox is not stored as a setting of its own" do
    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { version: "", version_empty: "1" } }

    assert_not_includes @target.reload.publication_settings.keys, "version_empty"
  end

  # Round-tripping: the field renders empty rather than showing the marker as though it
  # were typed, which would turn it into a component by that name on the next save.
  test "the modal shows the box checked and the field empty" do
    @target.update!(publication_settings: { "version" => Publication::Catalog::EMPTY_MARKER })

    get edit_project_target_publication_settings_url(@project, @target), headers: modal_headers

    assert_select "input[type=checkbox][name='publication_settings[version_empty]'][checked]"
    assert_select "input[name='publication_settings[version]']" do |input|
      assert_equal "", input.first["value"].to_s
    end
  end

  # An inherited empty version reads as what it does, not as the marker that stores it.
  test "an inherited empty version is named in the blank choice" do
    @project.update!(publication_settings: { "version" => Publication::Catalog::EMPTY_MARKER })

    get edit_project_target_publication_settings_url(@project, @target), headers: modal_headers

    assert_select "input[name='publication_settings[version]']" do |input|
      assert_match(/Leave out every marked part \(from this project\)/, input.first["title"])
    end
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
  # A reveal.js output is the case: it is in no format family, so General is all it has.
  test "a level reaching one family gets no tab strip" do
    get edit_project_target_publication_settings_url(projects(:slides), targets(:slides_deck)),
      headers: modal_headers

    assert_select "[role=tablist]", false
    assert_select "[role=tabpanel]", 1
    assert_select "select[name='publication_settings[exercise_inline_hint]']"
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

  # The long tails go behind a disclosure rather than into the panel: eighteen knowl
  # switches ahead of the theme picker would bury it. They are still ordinary fields in the
  # same form -- a <details> hides its contents without unmounting them -- so one collapsed
  # and one open save together, which is the assertion that matters here.
  test "a group's options are fields of the form, inside a closed disclosure" do
    get edit_project_target_publication_settings_url(@project, targets(:one_web)),
      headers: modal_headers

    assert_select "details:not([open]) summary", text: /Knowls/
    assert_select "form details select[name='publication_settings[knowl_theorem]']"
    assert_select "form details table select[name='publication_settings[exercise_worksheet_solution]']"
  end

  # One disclosure, two tables: five margins in a row of labelled columns with no row
  # headers, twelve header slots in a grid that has them. The margins table is the case
  # where nothing on screen names a cell, so the field carries its own accessible name.
  test "the printout disclosure holds both of its tables" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "details summary", text: /Printout/
    assert_select "input[name='publication_settings[worksheet_margin]']" \
                  "[aria-label='Margin on all sides'][placeholder='0.75in']"
    assert_select "input[name='publication_settings[first_page_header_left]']" \
                  "[aria-label='First page header, left']"
  end

  # The numbering disclosure is anchored: it renders between division numbering and the
  # table of contents, not at the foot of the panel with the others. Asserted on the
  # rendered order, since that is the whole of what `after` is for.
  test "the numbering disclosure renders under division numbering" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    panel = css_select("#publication-panel-general").first.to_html
    positions = [ "publication_settings_division_numbering_level",
                  "More numbering options",
                  "publication_settings_toc_level" ].map { |mark| panel.index(mark) }

    assert_equal positions.compact.sort, positions
    assert_select "select[name='publication_settings[numbering_blocks_level]']"
    assert_select "select[name='publication_settings[numbering_figures_distinct]']"
    assert_select "select[name='publication_settings[numbering_blocks_distinct]']", false
  end

  test "a knowl and an exercise component save like any other option" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { knowl_theorem: "yes", exercise_inline_solution: "no" } }

    assert_equal({ "knowl_theorem" => "yes", "exercise_inline_solution" => "no" },
                 @project.reload.publication_settings)
  end

  # The one option PreTeXt.Plus writes a default for. Its empty choice has to name that
  # default rather than PreTeXt's, which is the opposite value.
  test "the embed button's empty choice names the default a build actually uses" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "select[name='publication_settings[embed_button]'] option[value='']",
                  text: /PreTeXt\.Plus default \(Offer an embed button\)/
  end
end
