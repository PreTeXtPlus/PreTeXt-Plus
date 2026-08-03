require "test_helper"

class Publication::SettingsTest < ActiveSupport::TestCase
  setup do
    @user = users(:one)
    @project = projects(:one)      # an article, owned by :one
    @target = targets(:one_web)    # a website on that project
  end

  # The whole point of the feature: three levels, each overriding the one above it *per
  # option* rather than wholesale.
  test "a level overrides only the options it sets, and inherits the rest" do
    @user.update!(publication_settings: { "theme" => "salem", "division_numbering_level" => "1" })
    @project.update!(publication_settings: { "chunk_level" => "2" })
    @target.update!(publication_settings: { "theme" => "denver" })

    assert_equal({ "theme" => "denver", "division_numbering_level" => "1", "chunk_level" => "2" },
                 Publication::Settings.effective_for(@target))
  end

  test "a project resolves against its owner and stops there" do
    @user.update!(publication_settings: { "theme" => "salem" })
    @project.update!(publication_settings: { "chunk_level" => "1" })
    @target.update!(publication_settings: { "theme" => "denver" })

    assert_equal({ "theme" => "salem", "chunk_level" => "1" },
                 Publication::Settings.effective_for(@project))
  end

  test "nothing set anywhere resolves to nothing, not to a guessed default" do
    assert_empty Publication::Settings.effective_for(@target)
  end

  # "Inherit" is the absence of a key. If a blank were stored it would read as a choice
  # and shadow the level above, which is exactly what clearing an override must not do.
  test "a blank value clears an override rather than storing one" do
    @user.update!(publication_settings: { "theme" => "salem" })
    @target.update!(publication_settings: { "theme" => "denver" })

    @target.update!(publication_settings: { "theme" => "" })

    assert_empty @target.publication_settings
    assert_equal "salem", Publication::Settings.effective_for(@target)["theme"]
  end

  test "keys the catalog does not offer are dropped on write" do
    @project.update!(publication_settings: { "theme" => "salem", "latex_engine" => "xelatex" })

    assert_equal({ "theme" => "salem" }, @project.publication_settings)
  end

  # Values reach a publication file that a build server then runs, so they are checked
  # against the catalog rather than merely escaped on the way out.
  test "a value the catalog does not offer is rejected" do
    @project.publication_settings = { "theme" => "'; drop table projects" }

    assert_not @project.valid?
    assert_match(/theme/, @project.errors.full_messages.to_sentence)
  end

  # The select has to show what the author chose *here*, not what they inherited --
  # otherwise saving anything at all silently converts every inherited value into an
  # override pinned at this level.
  test "own reports only what this level sets" do
    @user.update!(publication_settings: { "theme" => "salem" })
    settings = Publication::Settings.new(@target)

    assert_nil settings.own("theme")
    assert_equal "salem", settings.effective["theme"]
  end

  test "inherited names the value and the nearest level it comes from" do
    @user.update!(publication_settings: { "theme" => "salem" })
    @project.update!(publication_settings: { "theme" => "denver" })

    assert_equal [ "denver", "this project" ], Publication::Settings.new(@target).inherited("theme")
  end

  test "the empty choice reads as the inherited value, labelled the way the option is" do
    @user.update!(publication_settings: { "chunk_level" => "1" })
    option = Publication::Catalog.find("chunk_level")

    label = Publication::Settings.new(@project).blank_choice_label(option)

    assert_equal "Inherit — A page per section (from your account)", label
  end

  test "the empty choice falls back to PreTeXt when no level above sets the option" do
    option = Publication::Catalog.find("theme")

    assert_equal "Inherit — PreTeXt's default",
                 Publication::Settings.new(@project).blank_choice_label(option)
    # The account level has nothing above it, so "inherit" would mean nothing there.
    assert_equal "PreTeXt's default", Publication::Settings.new(@user).blank_choice_label(option)
  end

  # An output shows only what its own format honors: PreTeXt ignores a theme on a PDF,
  # and offering one invites the author to believe otherwise.
  test "an output is offered only the options its format honors" do
    website = Publication::Settings.new(targets(:one_web)).options.map(&:key)
    pdf = Publication::Settings.new(targets(:one_print)).options.map(&:key)

    assert_includes website, "theme"
    assert_not_includes pdf, "theme"
    assert_includes pdf, "latex_sides"
    assert_not_includes website, "latex_sides"
    # General reaches both.
    [ website, pdf ].each { |keys| assert_includes keys, "division_numbering_level" }
  end

  # The tabs. A project gets every format it could build -- which is the point of showing
  # braille and EPUB to someone who has built neither -- while an output gets General plus
  # its own, and never a tab for a format it is not.
  test "an output drops the tabs its format does not reach" do
    def families_of(owner) = Publication::Settings.new(owner).families.map { |family, _| family.key }

    assert_equal %w[ general html pdf epub braille ], families_of(@project)
    assert_equal %w[ general html ], families_of(targets(:one_web))
    assert_equal %w[ general pdf ], families_of(targets(:one_print))
  end

  # Groups are how a panel stays readable: the handful of settings an author came for sit
  # in the panel, and the long tails go behind a disclosure. The split is by the option's
  # own `group`, so adding one to a group takes it out of the panel and nothing else.
  test "a panel lays out its options and its disclosures in one order" do
    settings = Publication::Settings.new(@project)
    families = settings.families.to_h.transform_keys(&:key)

    html = settings.sections(families["html"])

    assert_equal %w[ theme dark_mode chunk_level embed_button knowls ],
                 html.map { |section| section.group? ? section.group.key : section.option.key }
    assert_equal 18, html.last.options.size

    general = settings.sections(families["general"]).select(&:group?)

    assert_equal({ "numbering" => 11, "exercise_components" => 20, "printout" => 17 },
                 general.to_h { |section| [ section.group.key, section.options.size ] })
  end

  # A group that elaborates one setting sits under it, not at the foot of the panel: the
  # rest of the numbering options belong where an author is standing when they want them.
  # Groups with no anchor still go last, in catalog order.
  test "an anchored group sits under the option it elaborates" do
    settings = Publication::Settings.new(@project)
    general = settings.families.to_h.transform_keys(&:key)["general"]

    order = settings.sections(general).map { |s| s.group? ? s.group.key : s.option.key }

    assert_equal %w[ division_numbering_level numbering toc_level
                     exercise_components printout ], order
  end

  # Every grouped option's family is the family its group is declared under. They are two
  # declarations and could disagree, which would put a disclosure on a tab where none of
  # its options belong -- or, worse, split one group across two tabs.
  test "a grouped option sits in its group's family" do
    Publication::Catalog.all.select(&:group).each do |option|
      assert_equal Publication::Catalog::GROUPS.fetch(option.group).family, option.family,
                   option.key
    end
  end

  # The invariant that matters: a group's options and its grids' cells name the same set of
  # keys. An option no cell reaches is one an author can never set, and a cell reaching no
  # option is a hole in a table. Both are what generating options from the grid's own rows
  # and columns is supposed to make impossible.
  test "a group's options are exactly what its grids reach" do
    Publication::Catalog::GROUPS.each_value do |group|
      next unless group.grids?

      cells = group.grids.flat_map do |grid|
        grid.row_list.flat_map do |row_key, _|
          grid.columns.map { |column_key, _| grid.cell_key(row_key, column_key) }
        end
      end
      held = Publication::Catalog.all.select { |option| option.group == group.key }

      assert_equal held.map(&:key).sort,
                   cells.select { |key| Publication::Catalog.find(key) }.sort,
                   group.key
    end
  end

  # The one table that is deliberately ragged. PreTeXt has no numbering/blocks/@distinct --
  # blocks *are* the counter the others share -- and equations and footnotes have counters
  # with nothing to opt out of, so those three cells stay empty rather than offering a
  # switch that would be written into the file and ignored.
  test "the numbering table offers a counter only where PreTeXt has one" do
    grid = Publication::Catalog::GROUPS.fetch("numbering").grids.sole

    distinct = grid.rows.to_h.keys.select do |row|
      Publication::Catalog.find(grid.cell_key(row, "distinct"))
    end

    assert_equal %w[ exercises figures projects openproblems ], distinct
    grid.rows.each do |row, _|
      assert Publication::Catalog.find(grid.cell_key(row, "level")), row
    end
  end

  # A margin is interpolated into \newgeometry{left=...} in LaTeX that a build server then
  # compiles, so the pattern is the whole of what stands between a text field and that
  # command line. The units are the intersection of CSS and TeX, because the same string is
  # also written into a browser's page margins.
  test "a printout margin takes a length and nothing else" do
    option = Publication::Catalog.find("worksheet_top")

    assert option.free_text?
    %w[ 0.75in 2cm 18mm 36pt 1pc 2em 3ex 0in ].each do |value|
      assert option.permits?(value), value
    end
    %w[ 1px 2rem 1 in 0.75 -1in 1in} ].each do |value|
      assert_not option.permits?(value), value
    end
    assert_not option.permits?("1in}\\input{/etc/passwd")
    assert_not option.permits?("#{'1' * 20}in")
  end

  test "a printout margin is rejected on write like any other value" do
    @project.publication_settings = { "worksheet_margin" => "1px" }

    assert_not @project.valid?
    assert_match(/margin on all sides/, @project.errors.full_messages.to_sentence)
  end

  # What an author types and what LaTeX reads are not quite the same language: ".25" and
  # "0.25 IN" are lengths anyone would recognize and neither \newgeometry nor CSS will
  # take. They are stored as the length that was meant rather than refused, since refusing
  # them teaches nothing that writing the value back does not.
  test "a margin is stored as the length an author meant by it" do
    {
      ".25"     => "0.25in",
      "0.25"    => "0.25in",
      "3"       => "3in",
      "0.5 CM"  => "0.5cm",
      "  2mm  " => "2mm",
      "0.75in"  => "0.75in"
    }.each do |typed, stored|
      @project.publication_settings = { "worksheet_margin" => typed }

      assert_equal stored, @project.publication_settings["worksheet_margin"], typed
      assert @project.valid?, typed
    end
  end

  # The unit is the one guess here -- a bare number takes inches, which is the unit
  # PreTeXt's own 0.75in default is in. A unit the author did write and we cannot use is
  # not guessed at: it is kept as typed and refused, so the alert quotes what they typed.
  test "a margin in units neither LaTeX nor CSS shares is kept as typed and refused" do
    %w[ 1px 2rem 1inch -1in ].each do |typed|
      @project.publication_settings = { "worksheet_margin" => typed }

      assert_equal typed, @project.publication_settings["worksheet_margin"]
      assert_not @project.valid?, typed
    end
  end

  # A modal saves every setting of a level at once, so one value it cannot take is a reason
  # to keep that setting as it was -- not to drop the changes made beside it.
  test "merging settings keeps what it can and answers with what it could not" do
    @project.update!(publication_settings: { "worksheet_margin" => "1in" })

    saved, refused = @project.merge_publication_settings(
      "worksheet_margin" => "1 furlong", "theme" => "salem"
    )

    assert saved
    assert_equal [ [ Publication::Catalog.find("worksheet_margin"), "1 furlong" ] ], refused
    assert_equal({ "worksheet_margin" => "1in", "theme" => "salem" },
                 @project.reload.publication_settings)
  end

  # A setting stored before the catalog stopped permitting it would otherwise make the
  # level unsaveable: every save would fail on a value the author cannot even see, let
  # alone fix. It is dropped instead, and not reported -- they did not submit it.
  test "merging drops a stored value the catalog no longer permits, silently" do
    @project.update_column(:publication_settings, { "theme" => "brooklyn", "chunk_level" => "1" })

    saved, refused = @project.reload.merge_publication_settings("chunk_level" => "2")

    assert saved
    assert_empty refused
    assert_equal({ "chunk_level" => "2" }, @project.reload.publication_settings)
  end

  # A header is words an author picks, so it is bounded by a shape rather than a list. The
  # one thing ruled out is angle brackets: they cannot be meant in a page header, and the
  # value passes through an HTML attribute on its way to being printed.
  test "a printout header takes one line of text without angle brackets" do
    option = Publication::Catalog.find("first_page_header_left")

    assert option.permits?("Name: ______  Math 101 & 102")
    assert_not option.permits?("<script>alert(1)</script>")
    assert_not option.permits?("two\nlines")
    assert_not option.permits?("x" * 101)
  end

  # A text field's placeholder answers the same question a select's blank option does, but
  # in the space of a table cell: the value in force if there is one, the shape of a good
  # answer if there is not. The sentence goes on the title.
  test "a text field's placeholder shows what is in force, or the shape of an answer" do
    option = Publication::Catalog.find("worksheet_margin")

    assert_equal "0.75in", Publication::Settings.new(@project).placeholder_for(option)

    @user.update!(publication_settings: { "worksheet_margin" => "1in" })

    assert_equal "1in", Publication::Settings.new(@project.reload).placeholder_for(option)
    assert_equal "Inherit — 1in (from your account)",
                 Publication::Settings.new(@project).blank_choice_label(option)
  end

  # Twenty selects across four columns have no room for "Inherit — Show (from your
  # account)". The compact form drops the provenance and keeps the value, which is the half
  # that changes what a build does; the long form goes on the control's title.
  test "a grouped control's empty choice names the value without the sentence" do
    option = Publication::Catalog.find("exercise_inline_solution")

    assert_equal "Default — Show",
                 Publication::Settings.new(@user).compact_blank_label(option)
    assert_equal "Inherit — Show",
                 Publication::Settings.new(@project).compact_blank_label(option)

    @user.update!(publication_settings: { "exercise_inline_solution" => "no" })

    assert_equal "Inherit — Hide",
                 Publication::Settings.new(@project.reload).compact_blank_label(option)
    assert_equal "Inherit — Hide (from your account)",
                 Publication::Settings.new(@project).blank_choice_label(option)
  end

  # PreTeXt's own default for the embed button is "no" and ours is "yes". Naming PreTeXt as
  # the source would tell an author the opposite of what leaving the field alone does.
  test "an option PreTeXt.Plus defaults says whose default it is" do
    assert_equal "PreTeXt.Plus default (Offer an embed button)",
                 Publication::Settings.new(@user)
                   .blank_choice_label(Publication::Catalog.find("embed_button"))
    assert_equal "PreTeXt's default (Behind a link)",
                 Publication::Settings.new(@user)
                   .blank_choice_label(Publication::Catalog.find("knowl_proof"))
  end

  # Braille and EPUB are worth a tab on a project that has never built either -- an author
  # who does not know PreTeXt.Plus embosses braille will not go looking for the setting.
  # Braille asks for numbers, which need no project to supply, so it always shows.
  test "braille shows on any project, whether or not one has ever been built" do
    keys = Publication::Settings.new(@project).families.to_h.transform_keys(&:key)

    assert_includes keys.keys, "braille"
    assert_equal %w[ braille_page_width braille_page_height ], keys["braille"].map(&:key)
  end

  # An embosser's page is whatever that embosser does, so this is a number to type, not a
  # list to pick from. The range is ours; PreTeXt takes any positive whole number.
  test "a braille page size accepts whole numbers in range and nothing else" do
    option = Publication::Catalog.find("braille_page_width")

    assert option.free_number?
    assert option.permits?("40")
    assert_not option.permits?("0")
    assert_not option.permits?("101")
    assert_not option.permits?("40.5")
    assert_not option.permits?("wide")
  end

  test "a braille page size is rejected on write like any other value" do
    @project.publication_settings = { "braille_page_width" => "0" }

    assert_not @project.valid?
    assert_match(/cells per line/, @project.errors.full_messages.to_sentence)
  end

  # A free number has no list to read a label off, so it carries its unit instead -- the
  # difference between inheriting "40" and inheriting "40 cells".
  test "an inherited page size reads with its unit" do
    @user.update!(publication_settings: { "braille_page_width" => "32" })

    assert_equal "Inherit — 32 cells (from your account)",
                 Publication::Settings.new(@project)
                   .blank_choice_label(Publication::Catalog.find("braille_page_width"))
  end

  # Where PreTeXt's default is a fixed knowable thing, saying it is what makes an empty
  # number field usable. Where it follows the document's structure, we stay vague.
  test "the empty choice names PreTeXt's default only where there is one to name" do
    settings = Publication::Settings.new(@user)

    assert_equal "PreTeXt's default (40 cells)",
                 settings.blank_choice_label(Publication::Catalog.find("braille_page_width"))
    assert_equal "PreTeXt's default",
                 settings.blank_choice_label(Publication::Catalog.find("chunk_level"))
  end

  # ---- the EPUB cover, whose list is the project's own images ----

  def attach_image(asset, filename: "test_image.png")
    asset.file.attach(io: File.open(Rails.root.join("test/fixtures/files/#{filename}")),
                      filename:, content_type: "image/png")
    asset
  end

  # PreTeXt resolves the cover against the external directory, which is where
  # ProjectArchiveBuilder writes assets as "<ref><ext>" -- so the value an author picks is
  # an asset's own filename there, and the two have to agree.
  test "the cover offers the project's images by the name the archive writes them under" do
    asset = attach_image(assets(:image_one))
    settings = Publication::Settings.new(@project)
    option = Publication::Catalog.find("epub_cover")

    assert_equal [ "#{asset.ref}.png" ], settings.choices_for(option).map(&:first)
    assert_nil settings.unavailable_note(option)
  end

  # Regression test: a pasted-clipboard image's upload has no extension in its
  # filename (see Asset#file_extension), so the cover choice's name has to
  # come from the content type, matching what ProjectArchiveBuilder writes
  # the file as -- not from the upload's own (missing) extension.
  test "the cover offers an extensionless upload by its content-type-derived name" do
    asset = assets(:image_one)
    asset.file.attach(io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
                      filename: "pasted-image-1234567890", content_type: "image/png")
    settings = Publication::Settings.new(@project)
    option = Publication::Catalog.find("epub_cover")

    assert_equal [ "#{asset.ref}.png" ], settings.choices_for(option).map(&:first)
  end

  # The tab still earns its place: an author who has never made an EPUB should learn a
  # cover is a thing they can set, and what to do about it.
  test "a project with no images keeps the cover, with what to do about it" do
    settings = Publication::Settings.new(@project)
    option = Publication::Catalog.find("epub_cover")

    assert settings.offers?(option)
    assert_empty settings.choices_for(option)
    assert_match(/upload an image/i, settings.unavailable_note(option))
  end

  # A cover is a particular image in a particular project, so there is nothing for an
  # account default to mean.
  test "the account level does not offer a cover at all" do
    assert_not_includes Publication::Settings.new(@user).options.map(&:key), "epub_cover"
  end

  # The check that matters on a value written into a file a build server reads: it must be
  # a bare filename in the external directory, with no path in it.
  test "a cover value must be a bare filename" do
    option = Publication::Catalog.find("epub_cover")

    assert option.permits?("cover.png")
    assert_not option.permits?("../../etc/passwd")
    assert_not option.permits?("images/cover.png")
    assert_not option.permits?("cover")
  end

  # Membership is not checked on write: the concern runs on User too, which has no
  # project, and an asset deleted later must not make a project unsaveable.
  test "a cover naming an image the project no longer has still saves, and still reads" do
    @project.update!(publication_settings: { "epub_cover" => "gone.png" })

    assert_equal "gone.png", @project.reload.publication_settings["epub_cover"]
    assert_equal "gone.png",
                 Publication::Settings.new(@project).label_for(Publication::Catalog.find("epub_cover"), "gone.png")
  end

  # An option's tab and the outputs it affects are the same declaration, so they cannot
  # drift into saying different things -- which would put a setting under a tab that
  # promises it reaches formats it does not.
  test "every option's formats are its family's" do
    Publication::Catalog.all.each do |option|
      family = option.family_config

      assert_equal family.affects?("pdf"), option.affects?("pdf"), option.key
      assert_equal family.affects?("website"), option.affects?("website"), option.key
    end
  end

  # Chunking is written under <common> but only HTML honors it. The family is declared for
  # exactly this reason: deriving it from where the option lives in the file would put page
  # size on the General tab and promise a PDF author something that will not happen.
  test "an option's tab follows the formats it affects, not where it lives in the file" do
    chunking = Publication::Catalog.find("chunk_level")

    assert_equal %w[ common chunking ], chunking.element
    assert_equal "html", chunking.family
    assert_not chunking.affects?("pdf")
  end

  # An option a document type has nothing to say about is dropped from its family rather
  # than offered and then clamped: a slideshow numbers no divisions and lists no contents,
  # so both level options go, and General is left holding only what a slideshow can honor.
  test "a family drops the options its document type cannot use" do
    general = Publication::Settings.new(projects(:slides)).families.to_h
                                   .transform_keys(&:key)["general"]

    assert_not_includes general.map(&:key), "division_numbering_level"
    assert_not_includes general.map(&:key), "toc_level"
    assert_includes general.map(&:key), "exercise_inline_hint"
  end

  # reveal.js is in no format family, so a slides output keeps only General -- which every
  # output has, because exercise components are read by pretext-common.xsl and so reach
  # every conversion there is.
  test "an output in no format family still gets the General tab" do
    families = Publication::Settings.new(targets(:slides_deck)).families

    assert_equal %w[ general ], families.map { |family, _| family.key }
    assert families.first.last.all?(&:group),
           "a slideshow's General tab is groups only -- it numbers no divisions and lists " \
           "no contents, so both loose options drop"
  end

  # Both level options are bounded by the document's own structure: a book numbers one
  # division deeper than an article, and a slideshow numbers none at all.
  test "choices follow the document type" do
    book = Publication::Settings.new(projects(:team))
    article = Publication::Settings.new(projects(:one))

    assert_equal 5, Publication::Catalog.find("division_numbering_level")
      .choices_for(book.document_type).size
    assert_equal 4, Publication::Catalog.find("division_numbering_level")
      .choices_for(article.document_type).size
    assert_empty Publication::Catalog.find("division_numbering_level")
      .choices_for("slideshow")
  end

  # The account modal has no project, so it offers the widest list any document type
  # would. PreTeXt clamps an over-deep level, and the project's own modal will not offer
  # it, so the account default is never a build failure.
  test "the account level offers the widest list, since it has no document type" do
    settings = Publication::Settings.new(@user)

    assert_nil settings.document_type
    assert_equal 5, Publication::Catalog.find("division_numbering_level")
      .choices_for(settings.document_type).size
  end
end
