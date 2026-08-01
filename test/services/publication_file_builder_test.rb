require "test_helper"

class PublicationFileBuilderTest < ActiveSupport::TestCase
  def xml(settings)
    PublicationFileBuilder.new(settings).to_xml
  end

  # These two elements are not the author's to choose and not the catalog's to offer:
  # source/directories is where the archive actually puts assets, and html/resources is
  # what makes a built site load PreTeXt's JavaScript. A file missing either builds wrong.
  test "the elements a build depends on are in every file" do
    [ {}, { "theme" => "salem" } ].each do |settings|
      assert_match(/<directories external="external" generated="generated"\/>/, xml(settings))
      assert_match(/<resources host="cdn"\/>/, xml(settings))
    end
  end

  # Every spelling here was read off publisher-variables.xsl in @pretextbook/pretext-html,
  # which is the code that consumes them. A wrong element name is not an error -- PreTeXt
  # silently uses its default -- so these are the assertions that would catch a bad rename.
  test "each option lands at the path PreTeXt reads it from" do
    result = xml("theme" => "salem", "chunk_level" => "2", "division_numbering_level" => "1",
                 "toc_level" => "2", "dark_mode" => "no",
                 "latex_print" => "yes", "latex_sides" => "two")

    assert_match(%r{<css theme="salem" provide-dark-mode="no"/>}, result)
    assert_match(%r{<chunking level="2"/>}, result)
    assert_match(%r{<tableofcontents level="2"/>}, result)
    assert_match(%r{<numbering>\s*<divisions level="1"/>\s*</numbering>}, result)
    # <latex> carries its options as attributes on itself, not on a child.
    assert_match(%r{<latex print="yes" sides="two"/>}, result)
  end

  test "the epub and braille options land at their own paths" do
    result = xml("epub_cover" => "front.png",
                 "braille_page_width" => "32", "braille_page_height" => "28")

    assert_match(%r{<epub>\s*<cover front="front.png"/>\s*</epub>}, result)
    assert_match(%r{<braille>\s*<page width="32" height="28"/>\s*</braille>}, result)
  end

  # Two options can share an ancestor. Emitting two <html> elements would leave PreTeXt
  # reading only the first, so the theme or the CDN resources would go missing depending
  # on the order they happened to be written in.
  test "options sharing an ancestor are nested under one element" do
    result = xml("theme" => "salem")

    assert_equal 1, result.scan("<html ").length
    assert_match(%r{<html [^>]*>\s*<resources host="cdn"/>\s*<css theme="salem"/>\s*</html>}, result)
  end

  # Same hazard one level down: theme and dark mode are two attributes of one <css>, and
  # two <css> elements would leave PreTeXt reading only the first.
  test "options sharing an element become attributes of one element" do
    result = xml("theme" => "salem", "dark_mode" => "no")

    assert_equal 1, result.scan("<css ").length
  end

  test "an empty set of settings is the file every build starts from" do
    assert_equal <<~XML, xml({})
      <?xml version="1.0" encoding="UTF-8"?>
      <publication>
        <source>
          <directories external="external" generated="generated"/>
        </source>
        <html embed-button="yes">
          <resources host="cdn"/>
        </html>
      </publication>
    XML
  end

  # PreTeXt ships the embed button off; PreTeXt.Plus writes it on. It goes in as an
  # ordinary attribute rather than as part of BASE precisely so that an author's own
  # setting, merging next, can take it back off -- and the second assertion is the whole
  # reason for the distinction.
  test "an option PreTeXt.Plus defaults is written, and an author can override it" do
    assert_match(/<html embed-button="yes">/, xml({}))
    assert_match(/<html embed-button="no">/, xml("embed_button" => "no"))
  end

  # The two long tails. Every knowl is an attribute of one <html><knowl>, and every
  # exercise component an attribute of a per-type element under <common> -- so a family of
  # settings that shared an element and got written as several would silently lose all but
  # the first, which is the hazard the nesting exists for.
  test "knowl options become attributes of one element" do
    result = xml("knowl_theorem" => "yes", "knowl_proof" => "no", "knowl_figure" => "yes")

    assert_equal 1, result.scan("<knowl ").length
    assert_match(%r{<knowl theorem="yes" proof="no" figure="yes"/>}, result)
  end

  # Every numbered family is its own child of <numbering>, alongside <divisions>, and the
  # two attributes of one family land on one element. A family's level and its counter are
  # separate options in the catalog and must not come out as separate elements.
  test "numbering options join divisions under one numbering element" do
    result = xml("division_numbering_level" => "2", "numbering_blocks_level" => "1",
                 "numbering_figures_level" => "0", "numbering_figures_distinct" => "yes")

    assert_equal 1, result.scan("<numbering>").length
    assert_match(%r{<divisions level="2"/>}, result)
    assert_match(%r{<blocks level="1"/>}, result)
    assert_match(%r{<figures level="0" distinct="yes"/>}, result)
  end

  # The margins are attributes of <worksheet> itself; each header band is a child of it.
  # Two levels of nesting under one element that also carries attributes of its own, which
  # is the case most likely to come out as two <worksheet> elements.
  test "printout margins and headers nest under one worksheet element" do
    result = xml("worksheet_margin" => "1in", "worksheet_top" => "0.5in",
                 "first_page_header_left" => "Name:",
                 "running_footer_right" => "Math 101")

    assert_equal 1, result.scan("<worksheet ").length
    assert_match(%r{<worksheet margin="1in" top="0\.5in">}, result)
    assert_match(%r{<first-page-header left="Name:"/>}, result)
    assert_match(%r{<running-footer right="Math 101"/>}, result)
  end

  test "exercise component visibility lands under common, one element per exercise kind" do
    result = xml("exercise_inline_hint" => "no", "exercise_inline_solution" => "no",
                 "exercise_divisional_answer" => "no", "exercise_project_statement" => "no")

    assert_match(%r{<exercise-inline hint="no" solution="no"/>}, result)
    assert_match(%r{<exercise-divisional answer="no"/>}, result)
    assert_match(%r{<exercise-project statement="no"/>}, result)
  end

  # HasPublicationSettings validates values against the catalog, so this cannot come from
  # the interface -- but the file is handed to a build server, and escaping it here means
  # that stays true however a value gets into the column.
  test "values are escaped" do
    assert_match(/theme="a&quot;b"/, xml("theme" => 'a"b'))
  end

  # A key from an option the catalog has since retired is data we can no longer place, and
  # dropping it beats writing an element named after a guess.
  test "a key the catalog no longer knows is ignored" do
    assert_equal xml({}), xml("retired_option" => "whatever")
  end

  # preview_theme is a real, catalog-known option -- unlike the retired key above -- but it
  # has no element/attribute because it never reaches a publication file: it only picks the
  # theme the editor's own WASM renderer uses. A build must come out identical whether or
  # not an author has set it.
  test "the live preview theme is not written to the publication file" do
    assert_equal xml({}), xml("preview_theme" => "tacoma")
  end

  test "symbol keys resolve the same as string ones" do
    assert_equal xml("theme" => "salem"), xml(theme: "salem")
  end
end
