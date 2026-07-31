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

  # Two options can share an ancestor. Emitting two <html> elements would leave PreTeXt
  # reading only the first, so the theme or the CDN resources would go missing depending
  # on the order they happened to be written in.
  test "options sharing an ancestor are nested under one element" do
    result = xml("theme" => "salem")

    assert_equal 1, result.scan("<html>").length
    assert_match(%r{<html>\s*<resources host="cdn"/>\s*<css theme="salem"/>\s*</html>}, result)
  end

  # Same hazard one level down: theme and dark mode are two attributes of one <css>, and
  # two <css> elements would leave PreTeXt reading only the first.
  test "options sharing an element become attributes of one element" do
    result = xml("theme" => "salem", "dark_mode" => "no")

    assert_equal 1, result.scan("<css ").length
  end

  test "an empty set of settings is the file the build always had" do
    assert_equal <<~XML, xml({})
      <?xml version="1.0" encoding="UTF-8"?>
      <publication>
        <source>
          <directories external="external" generated="generated"/>
        </source>
        <html>
          <resources host="cdn"/>
        </html>
      </publication>
    XML
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

  test "symbol keys resolve the same as string ones" do
    assert_equal xml("theme" => "salem"), xml(theme: "salem")
  end
end
