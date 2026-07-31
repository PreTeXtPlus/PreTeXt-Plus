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

  # A family with nothing to show is left out rather than rendered empty: a slideshow
  # numbers no divisions and has no contents to list, so its General tab would be blank.
  test "a family with nothing to offer is dropped rather than shown empty" do
    slides = Publication::Settings.new(projects(:slides))

    assert_not_includes slides.families.map { |family, _| family.key }, "general"
    # reveal.js is in no format family, so a slides output has nothing at all.
    assert_empty Publication::Settings.new(targets(:slides_deck)).families
  end

  # Both level options are bounded by the document's own structure. A slideshow numbers no
  # divisions and pages itself, so its outputs have nothing to offer at all.
  test "choices follow the document type" do
    book = Publication::Settings.new(projects(:team))
    article = Publication::Settings.new(projects(:one))

    assert_equal 5, Publication::Catalog.find("division_numbering_level")
      .choices_for(book.document_type).size
    assert_equal 4, Publication::Catalog.find("division_numbering_level")
      .choices_for(article.document_type).size
    assert_empty Publication::Settings.new(targets(:slides_deck)).options
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
