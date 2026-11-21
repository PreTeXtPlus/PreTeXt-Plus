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

  # The journal picker end to end: it renders for an article's PDF, offers PreTeXt's own
  # codes as values, and saves one. The list is generated from PreTeXt's journals.xml, so
  # this is also what would catch a refresh that wrote something the form cannot store.
  test "an article's PDF offers the journal styles and saves one" do
    get edit_project_target_publication_settings_url(@project, targets(:one_print)),
      headers: modal_headers

    assert_select "select[name='publication_settings[journal]'] option[value=trans-ams]",
                  text: "Transactions of the American Mathematical Society"

    # Seventeen journals read as two lists, not one: the publisher-wide styles first,
    # because they are what an author reaches for when their own journal is not there.
    select = "select[name='publication_settings[journal]']"
    assert_select "#{select} optgroup", 2
    assert_select "#{select} optgroup:first-of-type[label='Publisher-wide styles'] option", 4
    assert_select "#{select} optgroup:last-of-type[label='Individual journals'] option[value=trans-ams]"
    # The blank choice still leads, outside either heading -- it is how a level inherits.
    assert_select "#{select} > option[value='']"

    patch project_target_publication_settings_url(@project, targets(:one_print)),
      params: { publication_settings: { journal: "trans-ams" } }

    assert_equal "trans-ams", targets(:one_print).reload.publication_settings["journal"]
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
    assert_equal "Settings saved.", flash[:notice]
  end

  # Components are separated by spaces because that is what PreTeXt splits on, but a list
  # is written with commas everywhere else and an author who types them means the same
  # thing. What gets stored is what the publication file needs.
  test "version components typed as a comma-separated list are saved space-separated" do
    patch project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { version: " instructor,  solutions " } }

    assert_equal "instructor solutions", @target.reload.publication_settings["version"]
    assert_equal "Settings saved.", flash[:notice]
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
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "#publication-tab-epub"
    assert_select "select[name='publication_settings[epub_cover]'] " \
                  "option[value=?]", "#{contents(:image_one).ref}.png"
  end

  # Without one, the tab stays but says what to do -- an author who has never built an
  # EPUB should still find out a cover is something they can set.
  test "with no images the cover says what to do instead of offering an empty picker" do
    get edit_project_publication_settings_url(projects(:slides)), headers: modal_headers

    assert_select "#publication-tab-epub"
    assert_select "select[name='publication_settings[epub_cover]']", false
    assert_select "#publication-panel-epub", /upload an image/i
  end

  test "the logo picker offers a subscriber the project's own images" do
    @user.update!(admin: true)
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "select[name='publication_settings[brandlogo]'] " \
                  "option[value=?]", "#{contents(:image_one).ref}.png"
  end

  test "a subscriber can type a link for the logo" do
    @user.update!(admin: true)
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "input[type=text][name='publication_settings[brandlogo_url]']"
  end

  test "the logo picker is replaced by a subscriber note for everyone else" do
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "select[name='publication_settings[brandlogo]']", false
    assert_select "input[name='publication_settings[brandlogo_url]']", false
    assert_select "#publication-panel-html", /subscribe to customize/i
    assert_select "#publication-panel-html a[href=?][data-turbo-frame=_top]", subscriptions_path,
                  text: "Subscribe"
  end

  # Panels are hidden, not unmounted, so a change on one tab and a change on another save
  # together. Anything else silently drops half of what an author just did.
  test "fields on every tab submit together" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { theme: "salem", latex_sides: "two", toc_level: "1" } }

    assert_equal({ "theme" => "salem", "latex_sides" => "two", "toc_level" => "1" },
                 @project.reload.publication_settings)
  end

  # A reveal.js output reaches General and its own slides tab -- never the Beamer tab,
  # whose options it would not read.
  test "a reveal.js output gets its own slides tab and not Beamer's" do
    get edit_project_target_publication_settings_url(projects(:slides), targets(:slides_deck)),
      headers: modal_headers

    assert_select "[role=tab]", 2
    assert_select "#publication-tab-revealjs"
    assert_select "#publication-tab-beamer", false
    assert_select "select[name='publication_settings[revealjs_theme]']"
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

  # ---- the XML view ----

  # What every view-switching request sends: Turbo aims it at the modal's frame.
  def switch(url, params)
    patch url, params:, headers: modal_headers
  end

  test "the settings view carries the level's XML along, and offers the way to edit it" do
    @project.update!(publication_xml: %(<publication><latex print="yes"/></publication>))
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "input[type=hidden][name=publication_xml_base][value*='latex print']"
    assert_select "input[name=publication_xml]", false
    assert_select "textarea[name=publication_xml]", false
    assert_select "button[name=view][value=xml][formaction=?]", switch_project_publication_settings_path(@project)
  end

  # One view at a time: the XML replaces the settings rather than sitting beside them.
  test "switching to the XML shows unsaved settings in it, and saves nothing" do
    switch switch_project_publication_settings_url(@project),
      { view: "xml", publication_settings: { theme: "salem" },
        publication_xml: %(<publication><latex print="yes"/></publication>) }

    assert_response :success
    assert_select "turbo-frame#modal textarea[name=publication_xml]", text: /css theme="salem".*latex print="yes"|latex print="yes".*css theme="salem"/m
    assert_select "[role=tab]", false
    assert_select "select[name='publication_settings[theme]']", false
    assert_select "#publication-xml-view pre", /<css theme="salem"/
    assert_select "button[name=view][value=settings]"
    assert_select "form", /Unsaved changes/
    assert_nil @project.reload.publication_xml
  end

  test "switching back shows what was typed into the XML, and saves nothing" do
    switch switch_project_publication_settings_url(@project),
      { view: "settings", publication_xml: %(<publication><html><css theme="denver"/></html><latex snapshot="yes"/></publication>) }

    assert_select "select[name='publication_settings[theme]'] option[selected][value=denver]"
    assert_select "input[type=hidden][name=publication_xml][value*=snapshot]"
    assert_select "input[name=publication_xml_base]", false, "unsaved XML goes as the XML to save"
    assert_nil @project.reload.publication_xml
  end

  # There is no reading settings out of text that does not parse.
  test "XML that would be refused cannot be left, and is shown again as typed" do
    switch switch_project_publication_settings_url(@project),
      { view: "settings", publication_xml: "<publication><latex>" }

    assert_select "textarea[name=publication_xml]", text: "<publication><latex>"
    assert_select "#publication-xml-issues li", /not well-formed/
    assert_select "[role=tab]", false
  end

  test "a value the settings could not carry across is reported in the new view" do
    switch switch_project_publication_settings_url(@project),
      { view: "xml", publication_settings: { worksheet_margin: "1 furlong", theme: "salem" } }

    assert_select "[role=alert]", /“1 furlong”/
    assert_select "textarea[name=publication_xml]", text: /salem/
  end

  test "switching is held to the same access as the modal" do
    sign_in users(:subscribed)
    switch switch_project_publication_settings_url(@project), { view: "xml" }

    assert_redirected_to projects_path
  end

  test "the XML view can be opened directly, with its warnings" do
    @project.update!(publication_xml: %(<publication><lateks/></publication>))
    get edit_project_publication_settings_url(@project, view: "xml"), headers: modal_headers

    assert_select "textarea[name=publication_xml]", text: /lateks/
    assert_select "#publication-xml-issues li", /lateks/
    assert_select "form[data-controller=publication-xml][data-publication-xml-url-value=?]",
                  check_project_publication_settings_path(@project)
  end

  # A cap on the field would cut a long paste short without a word, leaving XML that no
  # longer parses. The limit is the server's alone, and roomy: authors comment these files.
  test "a long, heavily commented file is taken whole" do
    xml = "<publication>\n#{"  <!-- #{'note ' * 20}-->\n" * 500}  <latex print=\"yes\"/>\n</publication>"
    get edit_project_publication_settings_url(@project, view: "xml"), headers: modal_headers
    assert_select "textarea[name=publication_xml][maxlength]", false

    patch project_publication_settings_url(@project), params: { publication_xml: xml }

    assert_operator xml.length, :>, 50_000
    assert_equal xml, @project.reload.publication_xml
  end

  test "XML saves with the settings" do
    patch project_publication_settings_url(@project),
      params: { publication_settings: { theme: "salem" },
                publication_xml: %(<publication><latex print="yes"/></publication>) }

    assert_redirected_to project_path(@project)
    assert_equal "Settings saved.", flash[:notice]
    assert_equal "salem", @project.reload.publication_settings["theme"]
    assert_match(/latex print/, @project.publication_xml)
  end

  test "XML with warnings saves, and the notice says so" do
    patch project_publication_settings_url(@project),
      params: { publication_xml: %(<publication><lateks/></publication>) }

    assert_match(/1 warning/, flash[:notice])
    assert_match(/lateks/, @project.reload.publication_xml)
  end

  # The same rule as a refused setting: the rest of the visit is saved, and the XML this
  # level had stays as it was rather than being replaced by something unusable.
  test "refused XML leaves the old XML in place and saves everything else" do
    @project.update!(publication_xml: %(<publication><latex print="yes"/></publication>))

    patch project_publication_settings_url(@project),
      params: { publication_settings: { theme: "salem" }, publication_xml: "<publication><latex>" }

    assert_match(/publication XML is unchanged/i, flash[:alert])
    assert_equal "salem", @project.reload.publication_settings["theme"]
    assert_match(/latex print="yes"/, @project.publication_xml)
  end

  test "an emptied field clears the XML, and a form without the field leaves it alone" do
    @project.update!(publication_xml: %(<publication><latex print="yes"/></publication>))

    patch project_publication_settings_url(@project), params: { publication_settings: { theme: "salem" } }
    assert @project.reload.publication_xml.present?

    patch project_publication_settings_url(@project), params: { publication_xml: "" }
    assert_nil @project.reload.publication_xml
  end

  test "check reports on XML without saving it" do
    post check_project_publication_settings_url(@project),
      params: { publication_xml: "<publication><latex>" }, as: :json

    assert_response :success
    assert_match(/not well-formed/, response.parsed_body["errors"].first["message"])
    assert_nil @project.reload.publication_xml
  end

  # The preview is the file a save would produce -- and check still saves nothing.
  test "check previews the whole form, unsaved" do
    post check_project_target_publication_settings_url(@project, @target),
      params: { publication_settings: { theme: "salem" },
                publication_xml: %(<publication><html><navigation logic="tree"/></html></publication>) }

    body = response.parsed_body
    assert_empty body["errors"]
    assert_match(%r{<css theme="salem"/>}, body["preview"])
    assert_match(%r{<navigation logic="tree"/>}, body["preview"])
    assert_empty @target.reload.publication_settings
    assert_nil @target.publication_xml
  end

  test "check is held to the same access as the modal" do
    sign_in users(:subscribed)
    post check_project_publication_settings_url(@project), params: { publication_xml: "" }, as: :json

    assert_response :forbidden
  end

  test "what the XML sets is what the other tabs show" do
    @project.update!(publication_xml: %(<publication><html><css theme="salem"/></html></publication>))
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "select[name='publication_settings[theme]'] option[selected][value=salem]"
  end

  # No field, so nothing is submitted for it and a save cannot blank it out.
  test "a value the modal does not offer is shown, not offered" do
    @project.update!(publication_xml: %(<publication><html><css theme="custom"/></html></publication>))
    get edit_project_publication_settings_url(@project), headers: modal_headers

    assert_select "select[name='publication_settings[theme]']", false
    assert_select "#publication-panel-html", /“custom”/

    patch project_publication_settings_url(@project), params: { publication_settings: { chunk_level: "1" } }
    assert_equal({ "theme" => "custom", "chunk_level" => "1" }, @project.reload.publication_settings)
  end

  # A textarea submits CRLF. Stored as typed, that would make untouched text look edited
  # on the next visit -- and, worse, look newer than a select changed in the same save.
  test "the XML is stored with the line endings it was typed with, not the browser's" do
    patch project_publication_settings_url(@project),
      params: { publication_xml: "<publication>\r\n  <latex print=\"yes\"/>\r\n</publication>" }

    assert_no_match(/\r/, @project.reload.publication_xml)
  end

  # Two people with the same modal open: the second save writes the fields its author
  # changed, and does not put back what the first one replaced.
  test "a save keeps what someone else saved since the modal opened" do
    drawn = %(<publication><html><css theme="salem"/></html></publication>)
    # Saved by a collaborator after this modal was drawn: a new theme, and XML the
    # settings view has no field for.
    @project.update!(publication_xml: %(<publication><html><css theme="denver"/></html><latex snapshot="yes"/></publication>))

    patch project_publication_settings_url(@project),
      params: { publication_xml_base: drawn, publication_settings: { theme: "salem", chunk_level: "1" } }

    settings = @project.reload.publication_settings
    assert_equal "denver", settings["theme"], "a field left as drawn is not a change"
    assert_equal "1", settings["chunk_level"]
    assert_match(/latex snapshot="yes"/, @project.publication_xml)
  end

  test "a field changed from what was drawn is written over a newer save" do
    drawn = %(<publication><html><css theme="salem"/></html></publication>)
    @project.update!(publication_xml: %(<publication><html><css theme="denver"/></html></publication>))

    patch project_publication_settings_url(@project),
      params: { publication_xml_base: drawn, publication_settings: { theme: "" } }

    assert_nil @project.reload.publication_settings["theme"]
  end
end
