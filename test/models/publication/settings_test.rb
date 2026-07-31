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

  # The tabs. A level that reaches every format gets all three; an output gets General
  # plus its own, and never a tab for a format it is not.
  test "an output drops the tabs its format does not reach" do
    def families_of(owner) = Publication::Settings.new(owner).families.map { |family, _| family.key }

    assert_equal %w[ general html pdf ], families_of(@project)
    assert_equal %w[ general html ], families_of(targets(:one_web))
    assert_equal %w[ general pdf ], families_of(targets(:one_print))
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
