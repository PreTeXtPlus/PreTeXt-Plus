require "test_helper"

# DivisionSourceSplitter is the web-editor's own `splitDivisionSource` run under
# Node; its cases are tested there (sectionUtils.test.ts). What is pinned here is
# the Ruby half: what goes over the pipe, and what comes back.
class DivisionSourceSplitterTest < ActiveSupport::TestCase
  Division = Struct.new(:id, :source, :source_format, :is_root, keyword_init: true)

  setup do
    skip "split bundle not built -- run `npm run build:assembler`" unless DivisionSourceSplitter::BUNDLE.exist?
  end

  test "takes each markup style's element apart into fields and a body" do
    pretext, latex, markdown = DivisionSourceSplitter.call([
      Division.new(id: "a", source_format: "pretext", is_root: false,
                   source: %(<section xml:id="s" label="L" component="teacher">\n<title>Hi <m>x</m></title>\n<p>Body</p>\n</section>)),
      Division.new(id: "b", source_format: "latex", is_root: false, source: "\\chapter{One}\\label{c}\n\nText."),
      Division.new(id: "c", source_format: "markdown", is_root: false,
                   source: "---\ndivision: worksheet\nid: w\ntitle: \"Practice\"\n---\n\n# Part\n")
    ])

    assert_equal [ "a", "section", "Hi <m>x</m>", "s", { "component" => "teacher" }, "<p>Body</p>", true ],
                 pretext.to_h.values_at(:id, :type, :title, :xml_id, :attrs, :body, :wrapped)
    # A division's label is its ref: the source's own is dropped, and reported.
    assert_equal [ "dropped label \"L\"; a division's label is its ref" ], pretext.warnings
    assert_equal [ "chapter", "One", "c", "Text." ], latex.to_h.values_at(:type, :title, :xml_id, :body)
    assert_equal [ "worksheet", "Practice", "w", "# Part" ], markdown.to_h.values_at(:type, :title, :xml_id, :body)
  end

  test "a root with no element of its own takes the type and title it is given" do
    result, = DivisionSourceSplitter.call(
      [ Division.new(id: "r", source_format: "latex", is_root: true, source: "Just prose.") ],
      root_type: "book", root_title: "My Book"
    )

    assert_equal [ "book", "My Book", "Just prose.", false ], result.to_h.values_at(:type, :title, :body, :wrapped)
  end

  test "a non-root with no element is a section" do
    result, = DivisionSourceSplitter.call(
      [ Division.new(id: "n", source_format: "pretext", is_root: false, source: "<p>Loose</p>") ],
      root_type: "book"
    )

    assert_equal "section", result.type
  end

  test "nothing to split is not a Node process" do
    assert_equal [], DivisionSourceSplitter.call([])
  end
end
