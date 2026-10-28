require "test_helper"

# DivisionSourceSplitter is the web-editor's own `splitDivisionSource` run under
# Node; its cases are tested there (sectionUtils.test.ts). What is pinned here is
# the Ruby half: what goes over the pipe, and what comes back.
class DivisionSourceSplitterTest < ActiveSupport::TestCase
  Division = Struct.new(:id, :ref, :source, :source_format, :is_root, keyword_init: true)

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

  # The pre-migration root shape: a root's source was its document's body, which
  # the editor wrapped in <article> on load, so a <section> at its head is its
  # first child -- not, as it would be for any other division, its own element.
  test "a root whose source opens with a <section> is the project's root type, with that section as body" do
    source = %(<section xml:id="s1">\n<title>One</title>\n<p>x</p>\n</section>)
    result, = DivisionSourceSplitter.call(
      [ Division.new(id: "r", ref: "r", source_format: "pretext", is_root: true, source: source) ],
      root_type: "article", root_title: "Notes"
    )

    assert_equal [ "article", "Notes", source, false, true ], result.to_h.values_at(:type, :title, :body, :wrapped, :lossless)
    assert_equal [ "a root's element is a root element; its leading <section> is body" ], result.warnings
  end

  test "reports a split that does not account for its whole source" do
    starred, plain = DivisionSourceSplitter.call([
      Division.new(id: "a", ref: "a", source_format: "latex", is_root: false, source: "\\section*{Starred}\n\nbody"),
      Division.new(id: "b", ref: "b", source_format: "latex", is_root: false, source: "\\section{Plain}\n\nbody")
    ])

    assert_not starred.lossless
    assert plain.lossless
  end

  # Not well formed: the element's close tag comes twice. Taking the element
  # for the body would have assembly wrap it in a second copy of itself, so the
  # split is reported instead -- and the migration refuses it.
  test "a division's own element that cannot be split around is reported, not kept as body" do
    result, = DivisionSourceSplitter.call([
      Division.new(id: "c", ref: "c", source_format: "pretext", is_root: false,
                   source: %(<chapter xml:id="c">\n<title>T</title>\n<p>x</p>\n</chapter>\n</chapter>))
    ])

    assert_not result.wrapped
    assert_not result.lossless
    assert_includes result.warnings, "source opens with the division's own element (c) but was not split around it"
  end

  test "a non-root with no element is a section" do
    result, = DivisionSourceSplitter.call(
      [ Division.new(id: "n", ref: "n", source_format: "pretext", is_root: false, source: "<p>Loose</p>") ],
      root_type: "book"
    )

    assert_equal "section", result.type
  end

  # A LaTeX introduction's source is its body alone -- the markup has no
  # `\introduction{...}` -- so the `\plus{introduction}{...}` that places it is
  # the only thing that says what it is.
  test "a non-root with no element takes the type of the placeholder that places it" do
    _root, intro, conclusion, orphan = DivisionSourceSplitter.call([
      Division.new(id: "r", ref: "r", source_format: "latex", is_root: true,
                   source: "\\article{Notes}\\label{r}\n\n\\plus{introduction}{i}\n\\plus[component=web]{conclusion}{c}\n"),
      Division.new(id: "i", ref: "i", source_format: "latex", is_root: false, source: "Opening words."),
      Division.new(id: "c", ref: "c", source_format: "latex", is_root: false, source: "Closing words."),
      Division.new(id: "o", ref: "o", source_format: "latex", is_root: false, source: "Placed nowhere.")
    ])

    assert_equal [ "introduction", "", "Opening words.", false ], intro.to_h.values_at(:type, :title, :body, :wrapped)
    assert_equal "conclusion", conclusion.type
    assert_equal "section", orphan.type
  end

  test "a source's own element outranks the placeholder that places it" do
    _parent, child = DivisionSourceSplitter.call([
      Division.new(id: "p", ref: "p", source_format: "pretext", is_root: false,
                   source: %(<chapter xml:id="p">\n<plus:section ref="w"/>\n</chapter>)),
      Division.new(id: "w", ref: "w", source_format: "pretext", is_root: false,
                   source: %(<worksheet xml:id="w">\n<p>Do this.</p>\n</worksheet>))
    ])

    assert_equal "worksheet", child.type
  end

  test "placeholders that disagree about a type are reported" do
    _a, _b, child = DivisionSourceSplitter.call([
      Division.new(id: "a", ref: "a", source_format: "latex", is_root: false, source: "\\plus{introduction}{x}"),
      Division.new(id: "b", ref: "b", source_format: "latex", is_root: false, source: "\\plus{conclusion}{x}"),
      Division.new(id: "x", ref: "x", source_format: "latex", is_root: false, source: "Both.")
    ])

    assert_equal "introduction", child.type
    assert_equal [ "placed as both introduction and conclusion; kept introduction" ], child.warnings
  end

  test "nothing to split is not a Node process" do
    assert_equal [], DivisionSourceSplitter.call([])
  end
end
